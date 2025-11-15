import { useTranslation } from '@pancakeswap/localization'
import { Currency, CurrencyAmount, Native, Trade, TradeType } from '@pancakeswap/sdk'
import { CAKE, STABLE_COIN, USDC, USDT } from '@pancakeswap/tokens'
import { PairDataTimeWindowEnum } from '@pancakeswap/uikit'
import tryParseAmount from '@pancakeswap/utils/tryParseAmount'
import { useQuery } from '@tanstack/react-query'
import { CHAIN_QUERY_NAME, getChainId } from 'config/chains'
import dayjs from 'dayjs'
import { useTradeExactIn, useTradeExactOut } from 'hooks/Trades'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useAutoSlippageWithFallback } from 'hooks/useAutoSlippageWithFallback'
import { useGetENSAddressByName } from 'hooks/useGetENSAddressByName'
import useNativeCurrency from 'hooks/useNativeCurrency'
import { useAtom, useAtomValue } from 'jotai'
import { useRouter } from 'next/router'
import { ParsedUrlQuery } from 'querystring'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChartPeriod, chainIdToExplorerInfoChainName, explorerApiClient } from 'state/info/api/client'
import { isAddressEqual, safeGetAddress } from 'utils'
import { computeSlippageAdjustedAmounts } from 'utils/exchange'
import { useBridgeAvailableRoutes } from 'views/Swap/Bridge/hooks'
import { useAccount } from 'wagmi'
import { DEFAULT_INPUT_CURRENCY } from 'config/constants/exchange'
import replaceBrowserHistoryMultiple from '@pancakeswap/utils/replaceBrowserHistoryMultiple'
import { useCurrencyBalances } from '../wallet/hooks'
import { Field, replaceSwapState } from './actions'
import { SwapState, swapReducerAtom } from './reducer'

export function useSwapState() {
  return useAtomValue(swapReducerAtom)
}

// TODO: update
const BAD_RECIPIENT_ADDRESSES: string[] = [
  '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // v2 factory
  '0xf164fC0Ec4E93095b804a4795bBe1e041497b92a', // v2 router 01
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // v2 router 02
]

/**
 * Returns true if any of the pairs or tokens in a trade have the given checksummed address
 * @param trade to check for the given address
 * @param checksummedAddress address to check in the pairs and tokens
 */
function involvesAddress(trade: Trade<Currency, Currency, TradeType>, checksummedAddress: string): boolean {
  return (
    trade.route.path.some((token) => isAddressEqual(token.address, checksummedAddress)) ||
    trade.route.pairs.some((pair) => isAddressEqual(pair.liquidityToken.address, checksummedAddress))
  )
}

// Get swap price for single token disregarding slippage and price impact

// from the current swap inputs, compute the best trade and return it.
export function useDerivedSwapInfo(
  independentField: Field,
  typedValue: string,
  inputCurrency: Currency | undefined,
  outputCurrency: Currency | undefined,
  recipient: string,
): {
  currencies: { [field in Field]?: Currency }
  currencyBalances: { [field in Field]?: CurrencyAmount<Currency> }
  parsedAmount: CurrencyAmount<Currency> | undefined
  v2Trade: Trade<Currency, Currency, TradeType> | undefined
  inputError?: string
} {
  const { address: account } = useAccount()
  const { t } = useTranslation()
  const { address: recipientENSAddress } = useGetENSAddressByName(recipient)

  const to: string | null =
    (recipient === null ? account : safeGetAddress(recipient) || safeGetAddress(recipientENSAddress) || null) ?? null

  const relevantTokenBalances = useCurrencyBalances(
    account ?? undefined,
    useMemo(() => [inputCurrency ?? undefined, outputCurrency ?? undefined], [inputCurrency, outputCurrency]),
  )

  const isExactIn: boolean = independentField === Field.INPUT

  const parsedAmount = tryParseAmount(typedValue, (isExactIn ? inputCurrency : outputCurrency) ?? undefined)

  const bestTradeExactIn = useTradeExactIn(isExactIn ? parsedAmount : undefined, outputCurrency ?? undefined)
  const bestTradeExactOut = useTradeExactOut(inputCurrency ?? undefined, !isExactIn ? parsedAmount : undefined)

  const v2Trade = isExactIn ? bestTradeExactIn : bestTradeExactOut

  const currencyBalances = {
    [Field.INPUT]: relevantTokenBalances[0],
    [Field.OUTPUT]: relevantTokenBalances[1],
  }

  const currencies: { [field in Field]?: Currency } = {
    [Field.INPUT]: inputCurrency ?? undefined,
    [Field.OUTPUT]: outputCurrency ?? undefined,
  }

  let inputError: string | undefined
  if (!account) {
    inputError = t('Connect Wallet')
  }

  if (!parsedAmount) {
    inputError = inputError ?? t('Enter an amount')
  }

  if (!currencies[Field.INPUT] || !currencies[Field.OUTPUT]) {
    inputError = inputError ?? t('Select a token')
  }

  const formattedTo = safeGetAddress(to)
  if (!to || !formattedTo) {
    inputError = inputError ?? t('Enter a recipient')
  } else if (
    BAD_RECIPIENT_ADDRESSES.indexOf(formattedTo) !== -1 ||
    (bestTradeExactIn && involvesAddress(bestTradeExactIn, formattedTo)) ||
    (bestTradeExactOut && involvesAddress(bestTradeExactOut, formattedTo))
  ) {
    inputError = inputError ?? t('Invalid recipient')
  }
  // @ts-ignore
  const { slippageTolerance: allowedSlippage } = useAutoSlippageWithFallback()

  const slippageAdjustedAmounts = v2Trade && allowedSlippage && computeSlippageAdjustedAmounts(v2Trade, allowedSlippage)

  // compare input balance to max input based on version
  const [balanceIn, amountIn] = [
    currencyBalances[Field.INPUT],
    slippageAdjustedAmounts ? slippageAdjustedAmounts[Field.INPUT] : null,
  ]

  if (balanceIn && amountIn && balanceIn.lessThan(amountIn)) {
    inputError = t('Insufficient %symbol% balance', { symbol: amountIn.currency.symbol })
  }

  return {
    currencies,
    currencyBalances,
    parsedAmount,
    v2Trade: v2Trade ?? undefined,
    inputError,
  }
}

function parseTokenAmountURLParameter(urlParam: any): string {
  return typeof urlParam === 'string' && !Number.isNaN(parseFloat(urlParam)) ? urlParam : ''
}

function parseIndependentFieldURLParameter(urlParam: any): Field {
  return typeof urlParam === 'string' && urlParam.toLowerCase() === 'output' ? Field.OUTPUT : Field.INPUT
}

const ENS_NAME_REGEX = /^[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)?$/

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
function validatedRecipient(recipient: any): string | null {
  if (typeof recipient !== 'string') return null
  const address = safeGetAddress(recipient)
  if (address) return address
  if (ENS_NAME_REGEX.test(recipient)) return recipient
  if (ADDRESS_REGEX.test(recipient)) return recipient
  return null
}

export function queryParametersToSwapState(
  parsedQs: ParsedUrlQuery,
  nativeSymbol?: string,
  defaultOutputCurrency?: string,
): SwapState {
  // Parse chains
  const inputChain = parsedQs.chain
  const outputChain = parsedQs.chainOut

  const inputChainId = typeof inputChain === 'string' ? getChainId(inputChain) : undefined
  const outputChainId = typeof outputChain === 'string' ? getChainId(outputChain) : undefined

  const recipient = validatedRecipient(parsedQs.recipient)

  // Parse currencies
  let inputCurrency =
    safeGetAddress(parsedQs.inputCurrency) ||
    (inputChainId ? Native.onChain(inputChainId).symbol : nativeSymbol || DEFAULT_INPUT_CURRENCY)
  let outputCurrency =
    typeof parsedQs.outputCurrency === 'string'
      ? safeGetAddress(parsedQs.outputCurrency) || (outputChainId ? Native.onChain(outputChainId).symbol : nativeSymbol)
      : defaultOutputCurrency
  if (inputCurrency === outputCurrency && inputChainId === outputChainId) {
    if (typeof parsedQs.outputCurrency === 'string') {
      inputCurrency = ''
    } else {
      outputCurrency = ''
    }
  }

  return {
    [Field.INPUT]: {
      currencyId: inputCurrency,
      chainId: inputChainId,
    },
    [Field.OUTPUT]: {
      currencyId: outputCurrency,
      chainId: outputChainId,
    },
    typedValue: parseTokenAmountURLParameter(parsedQs.exactAmount),
    independentField: parseIndependentFieldURLParameter(parsedQs.exactField),
    recipient,
    pairDataById: {},
    derivedPairDataById: {},
  }
}

// updates the swap state to use the defaults for a given network
export function useDefaultsFromURLSearch():
  | { inputCurrencyId: string | undefined; outputCurrencyId: string | undefined }
  | undefined {
  const { chainId } = useActiveChainId()
  const [, dispatch] = useAtom(swapReducerAtom)
  const native = useNativeCurrency()
  const { query, pathname, isReady } = useRouter()
  const [result, setResult] = useState<
    | {
        inputCurrencyId: string | undefined
        outputCurrencyId: string | undefined
        inputChainId: number | undefined
        outputChainId: number | undefined
      }
    | undefined
  >()

  const { data: supportedBridgeChains, isPending: isSupportedBridgePending } = useBridgeAvailableRoutes()

  useEffect(() => {
    if (!chainId || !native || !isReady) return

    const defaultOutputCurrency =
      CAKE[chainId]?.address ?? STABLE_COIN[chainId]?.address ?? USDC[chainId]?.address ?? USDT[chainId]?.address

    const parsed = queryParametersToSwapState(query, native.symbol, defaultOutputCurrency)

    let finalInputCurrencyId = parsed[Field.INPUT].currencyId
    let finalOutputCurrencyId = parsed[Field.OUTPUT].currencyId

    let finalInputChainId = parsed[Field.INPUT].chainId
    let finalOutputChainId = parsed[Field.OUTPUT].chainId

    if (isSupportedBridgePending && finalInputChainId !== finalOutputChainId) {
      return
    }

    const isNotTwapOrLimitPath = !['twap', 'limit'].some((p) => pathname.includes(p))

    let switchedToFallback = false

    // Set input currency to default (native currency) if chain is changed by user
    // and input currency is on different chain
    if (finalInputChainId && finalInputChainId !== chainId) {
      finalInputCurrencyId = native.symbol
      finalInputChainId = chainId

      const isOutputChainSupported =
        finalOutputChainId &&
        isNotTwapOrLimitPath &&
        supportedBridgeChains?.some(
          (route) => route.originChainId === finalInputChainId && route.destinationChainId === finalOutputChainId,
        )

      // If now input and output currencies are the same,
      // OR if output chain is NOT supported by the bridge,
      // set output currency to the default value
      if (
        !isOutputChainSupported ||
        (finalOutputCurrencyId === finalInputCurrencyId && finalOutputChainId === finalInputChainId)
      ) {
        finalOutputCurrencyId = defaultOutputCurrency
        finalOutputChainId = chainId
      }
      switchedToFallback = true
    }

    if (finalOutputChainId && finalOutputChainId !== chainId) {
      const isOutputChainSupported =
        isNotTwapOrLimitPath &&
        supportedBridgeChains?.some(
          (route) =>
            route.originChainId === (finalInputChainId || chainId) && route.destinationChainId === finalOutputChainId,
        )

      if (!isOutputChainSupported) {
        finalOutputCurrencyId = defaultOutputCurrency
        finalOutputChainId = chainId
      }
      switchedToFallback = true
    }

    // If input and output currencies are the same, set output currency to native currency (other default currency)
    if (finalInputCurrencyId === finalOutputCurrencyId && finalOutputChainId === finalInputChainId) {
      if (finalOutputCurrencyId !== native.symbol) {
        finalOutputCurrencyId = native.symbol
      } else {
        finalOutputCurrencyId = defaultOutputCurrency
      }
      switchedToFallback = true
    }

    dispatch(
      replaceSwapState({
        typedValue: parsed.typedValue,
        field: parsed.independentField,
        inputCurrencyId: finalInputCurrencyId,
        outputCurrencyId: finalOutputCurrencyId,
        inputChainId: finalInputChainId || chainId,
        outputChainId: finalOutputChainId || chainId,
        recipient: null,
      }),
    )

    if (switchedToFallback) {
      replaceBrowserHistoryMultiple({
        inputCurrency: finalInputCurrencyId,
        outputCurrency: finalOutputCurrencyId,
        chain: CHAIN_QUERY_NAME[finalInputChainId || chainId],
        chainOut: CHAIN_QUERY_NAME[finalOutputChainId || chainId],
      })
    }

    setResult({
      inputCurrencyId: finalInputCurrencyId,
      outputCurrencyId: finalOutputCurrencyId,
      inputChainId: finalInputChainId || chainId,
      outputChainId: finalOutputChainId || chainId,
    })
  }, [dispatch, chainId, query, native, isReady, pathname, supportedBridgeChains, isSupportedBridgePending])

  return result
}

type useFetchPairPricesParams = {
  token0Address: string
  token1Address: string
  timeWindow: PairDataTimeWindowEnum
  currentSwapPrice: {
    [key: string]: number
  }
}

const timeWindowToPeriod = (timeWindow: PairDataTimeWindowEnum): ChartPeriod => {
  switch (timeWindow) {
    case PairDataTimeWindowEnum.HOUR:
      return '1H'
    case PairDataTimeWindowEnum.DAY:
      return '1D'
    case PairDataTimeWindowEnum.WEEK:
      return '1W'
    case PairDataTimeWindowEnum.MONTH:
      return '1M'
    case PairDataTimeWindowEnum.YEAR:
      return '1Y'
    default:
      throw new Error('Invalid time window')
  }
}

export const usePairRate = ({
  token0Address,
  token1Address,
  timeWindow,
  currentSwapPrice,
}: useFetchPairPricesParams) => {
  const { chainId } = useActiveChainId()

  const chainName = chainIdToExplorerInfoChainName[chainId]

  return useQuery({
    queryKey: ['pair-rate', { token0Address, token1Address, chainId, timeWindow }],
    enabled: Boolean(token0Address && token1Address && chainId && chainName),
    queryFn: async ({ signal }) => {
      return explorerApiClient
        .GET('/cached/tokens/chart/{chainName}/rate', {
          signal,
          params: {
            path: {
              chainName,
            },

            query: {
              period: timeWindowToPeriod(timeWindow),
              tokenA: token0Address,
              tokenB: token1Address,
            },
          },
        })
        .then((res) => res.data)
    },
    select: useCallback(
      (data_) => {
        if (!data_) {
          throw new Error('No data')
        }
        const hasSwapPrice = currentSwapPrice && currentSwapPrice[token0Address] > 0

        const formatted = data_.map((d) => ({
          time: dayjs(d.bucket as string).toDate(),
          open: d.open ? +d.open : 0,
          close: d.close ? +d.close : 0,
          low: d.low ? +d.low : 0,
          high: d.high ? +d.high : 0,
          value: d.close ? +d.close : 0,
        }))
        if (hasSwapPrice) {
          return [...formatted, { time: new Date(), value: currentSwapPrice[token0Address] }]
        }
        return formatted
      },
      [currentSwapPrice, token0Address],
    ),
  })
}
