import { ChainId } from '@pancakeswap/chains'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useSidNameForAddress } from 'hooks/useSid'
import { useUnsNameForAddress } from 'hooks/useUns'
import { useMemo } from 'react'
import { Address } from 'viem'
import { useEnsAvatar, useEnsName } from 'wagmi'
import { useEnsSocialMedia } from './useEnsSocialMedia'

export const useDomainNameForAddress = (address?: `0x${string}` | string, fetchData = true) => {
  const { chainId } = useActiveChainId()
  const { sidName, isLoading: isSidLoading } = useSidNameForAddress(address as Address, fetchData)
  const { unsName, isLoading: isUnsLoading } = useUnsNameForAddress(
    address as Address,
    fetchData && !sidName && !isSidLoading,
  )
  const { data: ensName, isLoading: isEnsLoading } = useEnsName({
    address: address as Address,
    chainId: chainId === ChainId.GOERLI ? ChainId.GOERLI : ChainId.ETHEREUM,
    query: {
      enabled: Boolean(fetchData && address && chainId !== ChainId.BSC && chainId !== ChainId.BSC_TESTNET),
    },
  })
  const { data: ensAvatar, isLoading: isEnsAvatarLoading } = useEnsAvatar({
    name: ensName as string,
    chainId: chainId === ChainId.GOERLI ? ChainId.GOERLI : ChainId.ETHEREUM,
    query: {
      enabled: Boolean(fetchData && address && ensName && chainId !== ChainId.BSC && chainId !== ChainId.BSC_TESTNET),
    },
  })
  const socialMedia = useEnsSocialMedia(ensName, fetchData && Boolean(ensName))

  return useMemo(() => {
    return {
      domainName: ensName || sidName || unsName,
      avatar: ensAvatar ?? undefined,
      socialMedia: socialMedia.twitter || socialMedia.github || socialMedia.url ? socialMedia : undefined,
      isLoading: isEnsLoading || isEnsAvatarLoading || (!ensName && isSidLoading) || (!sidName && isUnsLoading),
    }
  }, [sidName, unsName, isSidLoading, isUnsLoading, ensName, isEnsLoading, ensAvatar, isEnsAvatarLoading, socialMedia])
}
