import { useDebounce } from '@pancakeswap/hooks'
import { useTranslation } from '@pancakeswap/localization'
import { Token, ERC20Token } from '@pancakeswap/sdk'
import {
  AutoColumn,
  BscScanIcon,
  Button,
  Column,
  DeleteOutlineIcon,
  IconButton,
  Input,
  Link,
  Text,
} from '@pancakeswap/uikit'
import Row, { RowBetween, RowFixed } from 'components/Layout/Row'
import { CurrencyLogo } from 'components/Logo'
import { useTokenByChainId } from 'hooks/Tokens'
import { useGetENSAddressByName } from 'hooks/useGetENSAddressByName'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { RefObject, useCallback, useMemo, useRef, useState } from 'react'
import { useRemoveUserAddedToken } from 'state/user/hooks'
import useUserAddedTokens from 'state/user/hooks/useUserAddedTokens'
import { styled } from 'styled-components'
import { getBlockExploreLink, safeGetAddress } from 'utils'
import { useReadContracts } from '@pancakeswap/wagmi'
import { erc20Abi, type Address } from 'viem'
import ImportRow from './ImportRow'
import { CurrencyModalView } from './types'

const Wrapper = styled.div`
  width: 100%;
  height: calc(100% - 60px);
  position: relative;
  padding-bottom: 60px;
`

const Footer = styled.div`
  position: absolute;
  bottom: 0;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const ENS_NAME_REGEX = /^[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)?$/

export default function ManageTokens({
  setModalView,
  setImportToken,
  chainId: chainIdProp,
}: {
  setModalView: (view: CurrencyModalView) => void
  setImportToken: (token: Token) => void
  chainId?: number
}) {
  const { chainId: activeChainId } = useActiveChainId()
  const chainId = chainIdProp || activeChainId

  const { t } = useTranslation()

  const [searchQuery, setSearchQuery] = useState<string>('')

  const inputRef = useRef<HTMLInputElement>()
  const handleInput = useCallback((event) => {
    const input = event.target.value
    // Don't checksum ENS names, only addresses
    const checksummedInput = safeGetAddress(input)
    setSearchQuery(checksummedInput || input)
  }, [])

  const debouncedSearchQuery = useDebounce(searchQuery, 500)

  const { address: resolvedENSAddress } = useGetENSAddressByName(debouncedSearchQuery)

  const isResolvingENS = useMemo(() => {
    return Boolean(
      debouncedSearchQuery && ENS_NAME_REGEX.test(debouncedSearchQuery) && !safeGetAddress(debouncedSearchQuery),
    )
  }, [debouncedSearchQuery])

  const tokenAddress = useMemo(() => {
    if (safeGetAddress(searchQuery)) {
      return searchQuery
    }
    if (resolvedENSAddress) {
      return safeGetAddress(resolvedENSAddress) || undefined
    }
    return undefined
  }, [searchQuery, resolvedENSAddress])

  const knownToken = useTokenByChainId(tokenAddress, chainId)

  const shouldCheckContract = useMemo(() => {
    return Boolean(
      tokenAddress &&
        chainId &&
        knownToken === undefined &&
        (isResolvingENS ? resolvedENSAddress : safeGetAddress(searchQuery)),
    )
  }, [tokenAddress, chainId, knownToken, isResolvingENS, resolvedENSAddress, searchQuery])

  const {
    data: tokenContractData,
    isLoading: isCheckingToken,
    isError: isNotToken,
  } = useReadContracts({
    allowFailure: true,
    contracts:
      shouldCheckContract && tokenAddress
        ? [
            {
              chainId,
              address: tokenAddress as Address,
              abi: erc20Abi,
              functionName: 'decimals',
            },
            {
              chainId,
              address: tokenAddress as Address,
              abi: erc20Abi,
              functionName: 'symbol',
            },
            {
              chainId,
              address: tokenAddress as Address,
              abi: erc20Abi,
              functionName: 'name',
            },
          ]
        : [],
    query: {
      enabled: shouldCheckContract,
      staleTime: Infinity,
    },
  })

  const searchToken = useMemo(() => {
    if (knownToken) return knownToken

    if (knownToken === null) return null

    if (tokenAddress && chainId && tokenContractData) {
      const results = tokenContractData
      if (results[0]?.status === 'success' && results[1]?.status === 'success' && results[2]?.status === 'success') {
        return new ERC20Token(
          chainId,
          tokenAddress as Address,
          results[0].result as number,
          (results[1].result as string) ?? 'UNKNOWN',
          (results[2].result as string) ?? 'Unknown Token',
        )
      }
    }

    return undefined
  }, [knownToken, tokenAddress, chainId, tokenContractData])

  const ensResolvedButNoToken = useMemo(() => {
    return Boolean(
      isResolvingENS &&
        resolvedENSAddress &&
        tokenAddress &&
        !isCheckingToken &&
        (isNotToken || searchToken === undefined) &&
        searchQuery === debouncedSearchQuery,
    )
  }, [
    isResolvingENS,
    resolvedENSAddress,
    tokenAddress,
    isCheckingToken,
    isNotToken,
    searchToken,
    searchQuery,
    debouncedSearchQuery,
  ])

  const userAddedTokens: Token[] = useUserAddedTokens(chainId)
  const removeToken = useRemoveUserAddedToken()

  const handleRemoveAll = useCallback(() => {
    if (chainId && userAddedTokens) {
      userAddedTokens.forEach((token) => {
        return removeToken(chainId, token.address)
      })
    }
  }, [removeToken, userAddedTokens, chainId])

  const tokenList = useMemo(() => {
    return (
      chainId &&
      userAddedTokens.map((token) => (
        <RowBetween key={token.address} width="100%">
          <RowFixed>
            <CurrencyLogo currency={token} size="20px" />
            <Link
              external
              href={getBlockExploreLink(token.address, 'address', chainId)}
              color="textSubtle"
              ml="10px"
              mr="3px"
            >
              {token.symbol}
            </Link>
            <a href={getBlockExploreLink(token.address, 'token', chainId)} target="_blank" rel="noreferrer noopener">
              <BscScanIcon width="20px" color="textSubtle" />
            </a>
          </RowFixed>
          <RowFixed>
            <IconButton variant="text" onClick={() => removeToken(chainId, token.address)}>
              <DeleteOutlineIcon color="textSubtle" />
            </IconButton>
          </RowFixed>
        </RowBetween>
      ))
    )
  }, [userAddedTokens, chainId, removeToken])

  const isAddressValid = useMemo(() => {
    if (searchQuery === '') return true
    if (safeGetAddress(searchQuery)) return true
    if (ENS_NAME_REGEX.test(searchQuery)) return true
    return false
  }, [searchQuery])

  return (
    <Wrapper>
      <Column style={{ width: '100%', flex: '1 1' }}>
        <AutoColumn gap="14px">
          <Row>
            <Input
              id="token-search-input"
              scale="lg"
              placeholder="0x0000 or name.eth"
              value={searchQuery}
              autoComplete="off"
              ref={inputRef as RefObject<HTMLInputElement>}
              onChange={handleInput}
              isWarning={!isAddressValid}
            />
          </Row>
          {!isAddressValid && searchQuery && <Text color="failure">{t('Enter valid token address or ENS name')}</Text>}
          {isResolvingENS && !resolvedENSAddress && <Text color="textSubtle">{t('Resolving ENS name...')}</Text>}
          {isResolvingENS && resolvedENSAddress && isCheckingToken && (
            <Text color="textSubtle">{t('Checking if address is a token contract...')}</Text>
          )}
          {ensResolvedButNoToken && (
            <Text color="failure">
              {t('ENS name resolved to %address%, but this address is not a token contract', {
                address: `${tokenAddress?.slice(0, 6)}...${tokenAddress?.slice(-4)}`,
              })}
            </Text>
          )}
          {searchToken && (
            <ImportRow
              token={searchToken}
              showImportView={() => setModalView(CurrencyModalView.importToken)}
              setImportToken={setImportToken}
              style={{ height: 'fit-content' }}
              chainId={chainId}
            />
          )}
        </AutoColumn>
        {tokenList}
        <Footer>
          <Text bold color="textSubtle">
            {userAddedTokens?.length} {userAddedTokens.length === 1 ? t('Imported Token') : t('Imported Tokens')}
          </Text>
          {userAddedTokens.length > 0 && (
            <Button variant="tertiary" onClick={handleRemoveAll}>
              {t('Clear all')}
            </Button>
          )}
        </Footer>
      </Column>
    </Wrapper>
  )
}
