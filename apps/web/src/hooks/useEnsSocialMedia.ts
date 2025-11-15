import { ChainId } from '@pancakeswap/chains'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useMemo } from 'react'
import { useEnsText } from 'wagmi'

export interface EnsSocialMedia {
  twitter?: string
  github?: string
  url?: string
}

export const useEnsSocialMedia = (
  ensName?: string | null,
  fetchData = true,
): EnsSocialMedia & { isLoading: boolean } => {
  const { chainId } = useActiveChainId()

  const enabled = Boolean(fetchData && ensName && chainId !== ChainId.BSC && chainId !== ChainId.BSC_TESTNET)

  const ensChainId = chainId === ChainId.GOERLI ? ChainId.GOERLI : ChainId.ETHEREUM

  const { data: twitterData, isLoading: isTwitterLoading } = useEnsText({
    name: ensName as string,
    key: 'com.twitter',
    chainId: ensChainId,
    query: {
      enabled: enabled && Boolean(ensName),
    },
  })

  const { data: twitterVndData } = useEnsText({
    name: ensName as string,
    key: 'vnd.twitter',
    chainId: ensChainId,
    query: {
      enabled: enabled && Boolean(ensName) && !twitterData,
    },
  })

  // Fetch GitHub
  const { data: githubData, isLoading: isGithubLoading } = useEnsText({
    name: ensName as string,
    key: 'com.github',
    chainId: ensChainId,
    query: {
      enabled: enabled && Boolean(ensName),
    },
  })

  // Fetch URL
  const { data: urlData, isLoading: isUrlLoading } = useEnsText({
    name: ensName as string,
    key: 'url',
    chainId: ensChainId,
    query: {
      enabled: enabled && Boolean(ensName),
    },
  })

  return useMemo(() => {
    const socialMedia: EnsSocialMedia = {}

    const twitter = twitterData || twitterVndData
    if (twitter) {
      const handle = twitter.startsWith('@') ? twitter.slice(1) : twitter
      socialMedia.twitter = handle
    }

    if (githubData) {
      const username = githubData.startsWith('@') ? githubData.slice(1) : githubData
      socialMedia.github = username
    }

    if (urlData) {
      socialMedia.url = urlData
    }

    return {
      ...socialMedia,
      isLoading: isTwitterLoading || isGithubLoading || isUrlLoading,
    }
  }, [twitterData, twitterVndData, githubData, urlData, isTwitterLoading, isGithubLoading, isUrlLoading])
}
