import { ChainId, getChainName } from '@pancakeswap/chains'
import { useDebounce } from '@pancakeswap/hooks'
import { useTranslation } from '@pancakeswap/localization'
import { Percent } from '@pancakeswap/sdk'
import { WrappedTokenInfo } from '@pancakeswap/token-lists'
import {
  AutoRenewIcon,
  BalanceInput,
  Box,
  Button,
  CloseIcon,
  FlexGap,
  GithubIcon,
  IconButton,
  Input,
  LazyAnimatePresence,
  LinkExternal,
  LinkIcon,
  ProfileAvatar,
  Skeleton,
  Text,
  TwitterIcon,
  domAnimation,
  useToast,
} from '@pancakeswap/uikit'
import tryParseAmount from '@pancakeswap/utils/tryParseAmount'
import truncateHash from '@pancakeswap/utils/truncateHash'
import { SwapUIV2 } from '@pancakeswap/widgets-internal'
import CurrencyLogo from 'components/Logo/CurrencyLogo'
import { ToastDescriptionWithTx } from 'components/Toast'
import { ASSET_CDN } from 'config/constants/endpoints'
import { BalanceData } from 'hooks/useAddressBalance'
import useCatchTxError from 'hooks/useCatchTxError'
import { useERC20 } from 'hooks/useContract'
import { useCurrencyUsdPrice } from 'hooks/useCurrencyUsdPrice'
import { useDomainNameForAddress } from 'hooks/useDomain'
import { useGetENSAddressByName } from 'hooks/useGetENSAddressByName'
import useNativeCurrency from 'hooks/useNativeCurrency'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { logGTMGiftPreviewEvent } from 'utils/customGTMEventTracking'
import { maxAmountSpend } from 'utils/maxAmountSpend'
import { checksumAddress, formatUnits, isAddress, zeroAddress } from 'viem'
import { CreateGiftView } from 'views/Gift/components/CreateGiftView'
import { SendGiftToggle } from 'views/Gift/components/SendGiftToggle'
import { CHAINS_WITH_GIFT_CLAIM } from 'views/Gift/constants'
import { SendGiftContext, useSendGiftContext } from 'views/Gift/providers/SendGiftProvider'
import { useUserInsufficientBalanceLight } from 'views/SwapSimplify/hooks/useUserInsufficientBalance'
import { useAccount, usePublicClient, useSendTransaction } from 'wagmi'
import { ActionButton } from './ActionButton'
import SendTransactionFlow from './SendTransactionFlow'
import { ViewState } from './type'

const FormContainer = styled(Box)`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const AssetContainer = styled(Box)`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
`

const ChainIconWrapper = styled(Box)`
  position: absolute;
  bottom: -4px;
  right: -4px;
  background: ${({ theme }) => theme.colors.background};
  border-radius: 50%;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);
  z-index: 1;
`

const AddressInputWrapper = styled(Box)`
  margin-bottom: 4px;
`

const ClearButton = styled(IconButton)`
  width: 20px;
  height: 20px;
`

const ErrorMessage = styled(Text)`
  color: ${({ theme }) => theme.colors.failure};
  font-size: 14px;
`

const ENS_NAME_REGEX = /^[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)?$/

const RecipientInfo = styled(FlexGap)`
  align-items: center;
  padding: 12px 16px;
  background: ${({ theme }) => theme.colors.input};
  border-radius: 16px;
  margin-top: 8px;
`

const RecipientAddressText = styled(Text)`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`

const SocialMediaLinks = styled(FlexGap)`
  align-items: center;
  gap: 8px;
  margin-left: auto;
`

const SocialLink = styled(LinkExternal)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSubtle};
  font-size: 12px;
  transition: opacity 0.2s;
  &:hover {
    opacity: 0.8;
  }
`

const SocialIconWrapper = styled(Box)`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
`

export interface SendAssetFormProps {
  asset: BalanceData
  onViewStateChange: (viewState: ViewState) => void
  viewState: ViewState
}

export const SendAssetForm: React.FC<SendAssetFormProps> = ({ asset, onViewStateChange, viewState }) => {
  const { isSendGift } = useContext(SendGiftContext)
  const isGiftSupported = useMemo(() => CHAINS_WITH_GIFT_CLAIM.includes(asset.chainId), [asset.chainId])
  const isSendGiftSupported = isSendGift && isGiftSupported

  const { t } = useTranslation()
  const [address, setAddress] = useState<string | null>(null)
  const debouncedAddress = useDebounce(address, 500)
  const [amount, setAmount] = useState('')
  const [addressError, setAddressError] = useState('')
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [estimatedFeeUsd, setEstimatedFeeUsd] = useState<string | null>(null)
  const [isInputFocus, setIsInputFocus] = useState(false)

  // Check if input is an ENS name
  const isEnsName = useMemo(() => {
    return Boolean(debouncedAddress && ENS_NAME_REGEX.test(debouncedAddress))
  }, [debouncedAddress])

  // Resolve ENS name to address
  const {
    address: resolvedAddress,
    isLoading: isResolvingEns,
    isError: isEnsResolutionError,
  } = useGetENSAddressByName(isEnsName ? debouncedAddress : undefined)

  // Determine the actual address to use (resolved ENS address or direct address)
  const recipientAddress = useMemo(() => {
    if (!debouncedAddress) return undefined
    if (isAddress(debouncedAddress)) {
      return debouncedAddress as `0x${string}`
    }
    if (isEnsName && resolvedAddress) {
      return resolvedAddress as `0x${string}`
    }
    return undefined
  }, [debouncedAddress, isEnsName, resolvedAddress])

  // Determine the display name (ENS name if entered, or resolved ENS name from address)
  const displayName = useMemo(() => {
    if (isEnsName) {
      return debouncedAddress
    }
    return undefined
  }, [debouncedAddress, isEnsName])

  const isValidRecipientAddress = useMemo((): boolean => {
    return Boolean(recipientAddress && !addressError)
  }, [recipientAddress, addressError])

  const {
    domainName,
    avatar,
    socialMedia,
    isLoading: isDomainLoading,
  } = useDomainNameForAddress(recipientAddress, Boolean(recipientAddress))

  const finalDisplayName = displayName || domainName

  const [txHash, setTxHash] = useState<string | undefined>(undefined)
  const { address: accountAddress } = useAccount()
  const publicClient = usePublicClient({ chainId: asset.chainId })
  const { toastSuccess } = useToast()
  const { fetchWithCatchTxError, loading: attemptingTxn } = useCatchTxError()
  const { includeStarterGas, nativeAmount, isUserInsufficientBalance } = useSendGiftContext()

  const nativeCurrency = useNativeCurrency(asset.chainId)
  const { data: nativeCurrencyPrice } = useCurrencyUsdPrice(nativeCurrency)
  const currency = useMemo(
    () =>
      asset.token.address === zeroAddress
        ? nativeCurrency
        : new WrappedTokenInfo({
            name: asset.token.name,
            symbol: asset.token.symbol,
            decimals: asset.token.decimals,
            address: checksumAddress(asset.token.address as `0x${string}`),
            chainId: asset.chainId,
            logoURI: asset.token.logoURI,
          }),
    [asset, nativeCurrency],
  )

  const tokenBalance = tryParseAmount(asset.quantity, currency)

  const maxAmountInput = useMemo(() => maxAmountSpend(tokenBalance), [tokenBalance])
  const isNativeToken = asset.token.address === zeroAddress
  const erc20Contract = useERC20(asset.token.address as `0x${string}`, { chainId: asset.chainId })
  const { sendTransactionAsync } = useSendTransaction()

  const estimateTransactionFee = useCallback(async () => {
    if (!recipientAddress || !amount || !publicClient || !accountAddress) return

    try {
      let gasEstimate: bigint = 0n

      if (isNativeToken) {
        // For native token, estimate gas for a simple transfer
        gasEstimate =
          (await publicClient.estimateGas({
            account: accountAddress,
            to: recipientAddress,
            value: tryParseAmount(amount, currency)?.quotient ?? 0n,
          })) ?? 0n
      } else {
        // For ERC20 tokens, estimate gas for a transfer call
        const transferData = {
          to: recipientAddress,
          amount: tryParseAmount(amount, currency)?.quotient ?? 0n,
        }
        gasEstimate =
          (await erc20Contract?.estimateGas?.transfer([transferData.to, transferData.amount], {
            account: erc20Contract.account!,
          })) ?? 0n
      }

      // Get gas price
      const gasPrice = await publicClient.getGasPrice()

      // Calculate fee
      const fee = gasEstimate * gasPrice

      // Convert to readable format (in native token units)
      const formattedFee = formatUnits(fee, 18)

      setEstimatedFee(formattedFee)

      // Calculate USD value if price is available
      if (nativeCurrencyPrice) {
        const feeUsd = parseFloat(formattedFee) * nativeCurrencyPrice
        setEstimatedFeeUsd(feeUsd.toFixed(2))
      } else {
        setEstimatedFeeUsd(null)
      }
    } catch (error) {
      console.error('Error estimating fee:', error)
      setEstimatedFee(null)
      setEstimatedFeeUsd(null)
    }
  }, [
    recipientAddress,
    amount,
    publicClient,
    accountAddress,
    isNativeToken,
    currency,
    nativeCurrencyPrice,
    erc20Contract,
  ])

  const sendAsset = useCallback(async () => {
    if (!recipientAddress) {
      return undefined
    }

    const amounts = tryParseAmount(amount, currency)

    const receipt = await fetchWithCatchTxError(async () => {
      if (isNativeToken) {
        // Handle native token transfer
        return sendTransactionAsync({
          to: recipientAddress,
          value: amounts?.quotient ?? 0n,
          chainId: asset.chainId,
        })
      }
      // Handle ERC20 token transfer
      return erc20Contract?.write?.transfer([recipientAddress, amounts?.quotient ?? 0n], {
        account: erc20Contract.account!,
        chain: erc20Contract.chain!,
      })
    })

    if (receipt?.status) {
      setTxHash(receipt.transactionHash)
      const displayAddress = finalDisplayName || `${recipientAddress.slice(0, 8)}...${recipientAddress.slice(-8)}`
      toastSuccess(
        `${t('Transaction Submitted')}!`,
        <ToastDescriptionWithTx txHash={receipt.transactionHash}>
          {t('Your %symbol% has been sent to %address%', {
            symbol: currency?.symbol,
            address: displayAddress,
          })}
        </ToastDescriptionWithTx>,
      )
      setAmount('')
      setAddress('')
    }

    return receipt
  }, [
    recipientAddress,
    amount,
    erc20Contract,
    isNativeToken,
    sendTransactionAsync,
    asset.chainId,
    fetchWithCatchTxError,
    t,
    toastSuccess,
    currency,
    finalDisplayName,
  ])

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target
    setAddress(value)
  }

  useEffect(() => {
    if (!debouncedAddress) {
      setAddressError('')
      return
    }

    if (isAddress(debouncedAddress)) {
      setAddressError('')
      return
    }

    if (ENS_NAME_REGEX.test(debouncedAddress)) {
      if (isEnsName && resolvedAddress) {
        setAddressError('')
        return
      }
      if (isEnsName && isEnsResolutionError && !isResolvingEns) {
        setAddressError(t('ENS name not found'))
        return
      }
      if (isEnsName && isResolvingEns) {
        setAddressError('')
        return
      }
      setAddressError('')
      return
    }

    // Invalid format
    setAddressError(t('Invalid wallet address or ENS name'))
  }, [debouncedAddress, isEnsName, resolvedAddress, isResolvingEns, isEnsResolutionError, t])

  const handleClearAddress = () => {
    setAddress('')
    setAddressError('')
  }

  const handleAmountChange = useCallback((value: string) => {
    setAmount(value)
  }, [])

  const handleUserInputBlur = useCallback(() => {
    setTimeout(() => setIsInputFocus(false), 300)
  }, [])

  const handlePercentInput = useCallback(
    (percent: number) => {
      if (maxAmountInput) {
        handleAmountChange(maxAmountInput.multiply(new Percent(percent, 100)).toExact())
      }
    },
    [maxAmountInput, handleAmountChange],
  )

  const handleMaxInput = useCallback(() => {
    handlePercentInput(100)
  }, [handlePercentInput])

  const isInsufficientBalance = useUserInsufficientBalanceLight(currency, tokenBalance, amount)

  const chainName = asset.chainId === ChainId.BSC ? 'BNB' : getChainName(asset.chainId)
  const price = asset.price?.usd ?? 0
  const tokenAmount = tryParseAmount(amount, currency)

  // if gift, tokenAmount must be greater than $1
  const isGiftTokenAmountValid = useMemo(() => {
    if (isSendGiftSupported && amount && !isInsufficientBalance) {
      const valueInUsd = parseFloat(amount) * price
      const LIMIT_AMOUNT_USD = 1

      return valueInUsd === 0 || valueInUsd >= LIMIT_AMOUNT_USD
    }

    return true
  }, [isSendGiftSupported, amount, isInsufficientBalance, price])

  useEffect(() => {
    if (recipientAddress && amount && !addressError) {
      estimateTransactionFee()
    } else {
      setEstimatedFee(null)
    }
  }, [recipientAddress, amount, addressError, estimateTransactionFee])

  const isValidAddress = useMemo(() => {
    // send gift doesn't need to check address
    return isSendGiftSupported ? true : recipientAddress && !addressError
  }, [recipientAddress, addressError, isSendGiftSupported])

  if (viewState === ViewState.CONFIRM_TRANSACTION && isSendGiftSupported) {
    return <CreateGiftView key={viewState} tokenAmount={tokenAmount} />
  }

  if (viewState >= ViewState.CONFIRM_TRANSACTION) {
    return (
      <SendTransactionFlow
        asset={asset}
        amount={amount}
        recipient={recipientAddress as string}
        onDismiss={() => {
          onViewStateChange(ViewState.SEND_ASSETS)
          setTxHash(undefined)
        }}
        attemptingTxn={attemptingTxn}
        txHash={txHash}
        chainId={asset.chainId}
        estimatedFee={estimatedFee}
        estimatedFeeUsd={estimatedFeeUsd}
        onConfirm={async () => {
          // Submit the transaction using the improved error handling
          const receipt = await sendAsset()
          if (receipt?.status) {
            onViewStateChange(ViewState.SEND_ASSETS)
          }
        }}
      />
    )
  }

  const isValidGasSponsor =
    includeStarterGas && isSendGiftSupported ? nativeAmount?.greaterThan(0) && !isUserInsufficientBalance : true

  return (
    <FormContainer>
      <SendGiftToggle isNativeToken={isNativeToken} tokenChainId={asset.chainId}>
        {(isSendGiftOn) => (
          <>
            {isSendGiftOn ? null : (
              <Box>
                <AddressInputWrapper>
                  <Box position="relative">
                    <Input
                      value={address ?? ''}
                      onChange={handleAddressChange}
                      placeholder="Recipient address or ENS name"
                      style={{ height: '64px' }}
                      isError={Boolean(addressError)}
                    />
                    {address && (
                      <ClearButton
                        scale="sm"
                        onClick={handleClearAddress}
                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)' }}
                        variant="tertiary"
                      >
                        <CloseIcon color="textSubtle" />
                      </ClearButton>
                    )}
                  </Box>
                </AddressInputWrapper>
                {addressError && <ErrorMessage>{addressError}</ErrorMessage>}
                {isValidRecipientAddress && (
                  <RecipientInfo gap="12px">
                    {isDomainLoading && !domainName ? (
                      <>
                        <Skeleton variant="circle" width="32px" height="32px" />
                        <Skeleton width="120px" height="20px" />
                      </>
                    ) : (
                      <>
                        <ProfileAvatar
                          width={32}
                          height={32}
                          src={avatar}
                          style={{ minWidth: '32px', minHeight: '32px', flexShrink: 0 }}
                        />
                        <RecipientAddressText>
                          {finalDisplayName || truncateHash(recipientAddress || (debouncedAddress as string))}
                        </RecipientAddressText>
                        {socialMedia && (
                          <SocialMediaLinks gap="8px">
                            {socialMedia.twitter && (
                              <SocialLink href={`https://twitter.com/${socialMedia.twitter}`} external fontSize="12px">
                                <SocialIconWrapper>
                                  <TwitterIcon width="16px" height="16px" color="white" />
                                </SocialIconWrapper>
                              </SocialLink>
                            )}
                            {socialMedia.github && (
                              <SocialLink href={`https://github.com/${socialMedia.github}`} external fontSize="12px">
                                <SocialIconWrapper>
                                  <GithubIcon width="16px" height="16px" color="textSubtle" />
                                </SocialIconWrapper>
                              </SocialLink>
                            )}
                            {socialMedia.url && (
                              <SocialLink href={socialMedia.url} external fontSize="12px">
                                <SocialIconWrapper>
                                  <LinkIcon width="16px" height="16px" color="textSubtle" />
                                </SocialIconWrapper>
                              </SocialLink>
                            )}
                          </SocialMediaLinks>
                        )}
                      </>
                    )}
                  </RecipientInfo>
                )}
              </Box>
            )}

            <Box>
              <FlexGap alignItems="center" gap="8px" justifyContent="space-between" position="relative">
                <FlexGap alignItems="center" gap="8px" mb="8px">
                  <AssetContainer>
                    <CurrencyLogo currency={currency} size="40px" src={asset.token.logoURI} />
                    <ChainIconWrapper>
                      <img
                        src={`${ASSET_CDN}/web/chains/${asset.chainId}.png`}
                        alt={`${chainName}-logo`}
                        width="12px"
                        height="12px"
                      />
                    </ChainIconWrapper>
                  </AssetContainer>
                  <FlexGap flexDirection="column">
                    <Text fontWeight="bold" fontSize="20px">
                      {asset.token.symbol}
                    </Text>
                    <Text color="textSubtle" fontSize="12px" mt="-4px">{`${chainName.toUpperCase()} ${t(
                      'Chain',
                    )}`}</Text>
                  </FlexGap>
                </FlexGap>
                <Box position="relative">
                  <LazyAnimatePresence mode="wait" features={domAnimation}>
                    {tokenBalance ? (
                      !isInputFocus ? (
                        <SwapUIV2.WalletAssetDisplay
                          isUserInsufficientBalance={isInsufficientBalance}
                          balance={tokenBalance.toSignificant(6)}
                          onMax={handleMaxInput}
                        />
                      ) : (
                        <SwapUIV2.AssetSettingButtonList onPercentInput={handlePercentInput} />
                      )
                    ) : null}
                  </LazyAnimatePresence>
                </Box>
              </FlexGap>

              <BalanceInput
                value={amount}
                onUserInput={handleAmountChange}
                onFocus={() => setIsInputFocus(true)}
                onBlur={handleUserInputBlur}
                currencyValue={amount ? `~${(parseFloat(amount) * price).toFixed(2)} USD` : ''}
                placeholder="0.0"
                unit={asset.token.symbol}
              />
              {isInsufficientBalance && amount && (
                <Text color="failure" fontSize="14px" mt="8px">
                  {t('Insufficient balance')}
                </Text>
              )}

              {!isGiftTokenAmountValid && (
                <Text color="failure" fontSize="14px" mt="8px">
                  {t('Gift amount must be greater than $1')}
                </Text>
              )}
            </Box>
          </>
        )}
      </SendGiftToggle>

      <FlexGap gap="16px" mt="16px">
        <ActionButton onClick={() => onViewStateChange(ViewState.SEND_ASSETS)} variant="tertiary">
          {t('Close')}
        </ActionButton>
        <Button
          id="send-gift-confirm-button"
          width="100%"
          onClick={() => {
            if (isSendGiftSupported) {
              logGTMGiftPreviewEvent(asset.chainId)
            }
            onViewStateChange(ViewState.CONFIRM_TRANSACTION)
          }}
          disabled={
            !isValidAddress ||
            !amount ||
            parseFloat(amount) === 0 ||
            isInsufficientBalance ||
            attemptingTxn ||
            !isValidGasSponsor ||
            !isGiftTokenAmountValid
          }
          isLoading={attemptingTxn}
          endIcon={attemptingTxn ? <AutoRenewIcon spin color="currentColor" /> : undefined}
        >
          {attemptingTxn ? t('Confirming') : t('Next')}
        </Button>
      </FlexGap>
    </FormContainer>
  )
}
