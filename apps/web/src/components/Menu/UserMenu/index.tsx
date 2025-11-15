import { useTranslation } from '@pancakeswap/localization'
import { Box, UserMenu as UIKitUserMenu, useMatchBreakpoints, UserMenuVariant } from '@pancakeswap/uikit'
import { usePrivy } from '@privy-io/react-auth'
import ConnectWalletButton from 'components/ConnectWalletButton'
import Trans from 'components/Trans'
import { WalletContent, WalletModalV2 } from 'components/WalletModalV2'
import ReceiveModal from 'components/WalletModalV2/ReceiveModal'
import { ViewState } from 'components/WalletModalV2/type'
import {
  useWalletModalV2ViewState,
  WalletModalV2ViewStateProvider,
} from 'components/WalletModalV2/WalletModalV2ViewStateProvider'
import { usePrivyWalletAddress } from 'contexts/Privy/hooks'
import { useActiveChainId } from 'hooks/useActiveChainId'
import useAuth from 'hooks/useAuth'
import { useDomainNameForAddress } from 'hooks/useDomain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useProfile } from 'state/profile/hooks'
import { usePendingTransactions } from 'state/transactions/hooks'
import styled from 'styled-components'
import { logGTMDisconnectWalletEvent } from 'utils/customGTMEventTracking'
import { useAutoFillCode } from 'views/Gift/hooks/useAutoFillCode'
import { ClaimGiftProvider, useClaimGiftContext } from 'views/Gift/providers/ClaimGiftProvider'
import { SendGiftProvider, useSendGiftContext } from 'views/Gift/providers/SendGiftProvider'
import { UnclaimedOnlyProvider } from 'views/Gift/providers/UnclaimedOnlyProvider'
import { useAccount, useEnsAvatar, useEnsName } from 'wagmi'
import { MenuTabProvider, useMenuTab, WalletView } from './providers/MenuTabProvider'

const UserMenuItems = ({ onReceiveClick, account }: { onReceiveClick: () => void; account: string | undefined }) => {
  const { chainId } = useActiveChainId()
  const { logout } = useAuth()
  const { connector } = useAccount()

  const handleClickDisconnect = useCallback(() => {
    logGTMDisconnectWalletEvent(chainId, connector?.name, account)
    logout()
  }, [logout, connector?.name, account, chainId])

  return (
    <WalletContent
      account={account}
      onDismiss={() => {}}
      onReceiveClick={onReceiveClick}
      onDisconnect={handleClickDisconnect}
    />
  )
}

// Custom wrapper for UIKitUserMenu that adds click functionality for desktop
const ClickableUserMenu = styled.div`
  position: relative;
`

const ClickablePopover = styled.div<{ isOpen: boolean }>`
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 1001;
  min-width: 380px;
  background-color: ${({ theme }) => theme.card.background};
  border: 1px solid ${({ theme }) => theme.colors.cardBorder};
  border-radius: 16px;
  margin-top: 8px;
  visibility: ${({ isOpen }) => (isOpen ? 'visible' : 'hidden')};
  opacity: ${({ isOpen }) => (isOpen ? 1 : 0)};
  transition: visibility 0.2s, opacity 0.2s;
`

const UserMenu = () => {
  const { t } = useTranslation()
  const { address: account, connector } = useAccount()
  const { ready, authenticated, user } = usePrivy()
  const { data: name } = useEnsName({ address: account, chainId: 1 })
  const { data: ensAvatar } = useEnsAvatar({ name: name ?? undefined, chainId: 1 })

  // Use new Privy wallet address hook to prevent flickering
  const { address: privyAddress, isLoading: isPrivyAddressLoading, addressType } = usePrivyWalletAddress()

  // Determine which address to use: if Privy login use privyAddress, otherwise use account
  const finalAddress = ready && authenticated && user ? privyAddress : account
  const shouldShowLoading = ready && authenticated && user ? isPrivyAddressLoading : false
  const { chainId, isWrongNetwork } = useActiveChainId()
  const { domainName, avatar } = useDomainNameForAddress(finalAddress)
  const { logout } = useAuth()
  const { hasPendingTransactions, pendingNumber } = usePendingTransactions()
  const { profile } = useProfile()
  const avatarSrc = profile?.nft?.image?.thumbnail ?? avatar
  const [userMenuText, setUserMenuText] = useState<string>('')
  const [userMenuVariable, setUserMenuVariable] = useState<UserMenuVariant>('default')
  const { isMobile } = useMatchBreakpoints()
  const [showMobileWalletModal, setShowMobileWalletModal] = useState(false)
  const [showDesktopPopup] = useState(true)
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false)

  const { reset: resetViewState, viewState } = useWalletModalV2ViewState()
  const { setCode, code: giftCode } = useClaimGiftContext()
  const { setNativeAmount, setIncludeStarterGas } = useSendGiftContext()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { setView } = useMenuTab()

  useAutoFillCode({
    onAutoFillCode: () => {
      if (isMobile) {
        setShowMobileWalletModal(true)
      } else {
        setIsMenuOpen(true)
      }
    },
  })

  useEffect(() => {
    if (isMenuOpen) {
      setView(WalletView.WALLET_INFO)
      setNativeAmount(undefined)
      setIncludeStarterGas(false)
    }
  }, [isMenuOpen, setView, setNativeAmount, setIncludeStarterGas])

  // Handle click outside to close menu
  useEffect(() => {
    // Disable click outside to close menu when sending gift
    if (viewState === ViewState.CONFIRM_TRANSACTION) {
      return undefined
    }

    const handleClickOutside = (event: MouseEvent) => {
      // Check if the click target is within portal-root

      const portalRoot = document.getElementById('portal-root')
      const isClickInPortal = portalRoot?.contains(event.target as Node)

      // Only close if click is outside menu and not in portal-root
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && !isClickInPortal) {
        setIsMenuOpen(false)
        // reset view state and code
        resetViewState()
        setCode('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuRef, viewState, resetViewState, setCode])

  useEffect(() => {
    if (hasPendingTransactions) {
      setUserMenuText(t('%num% Pending', { num: pendingNumber }))
      setUserMenuVariable('pending')
    } else {
      setUserMenuText('')
      setUserMenuVariable('default')
    }
  }, [hasPendingTransactions, pendingNumber, t])

  const handleClickDisconnect = useCallback(() => {
    logGTMDisconnectWalletEvent(chainId, connector?.name, finalAddress)
    logout()
  }, [logout, connector?.name, finalAddress, chainId])

  if (shouldShowLoading) {
    return (
      <ClickableUserMenu ref={menuRef}>
        <UIKitUserMenu
          account={t('Loading...')}
          ellipsis={false}
          avatarSrc={avatarSrc}
          text=""
          variant="default"
          popperStyle={{
            minWidth: '380px',
          }}
          onClick={() => {
            // Don't allow clicking during loading
          }}
        >
          {undefined}
        </UIKitUserMenu>
      </ClickableUserMenu>
    )
  }

  if (finalAddress || giftCode) {
    return (
      <>
        <ClickableUserMenu ref={menuRef}>
          <UIKitUserMenu
            account={domainName || finalAddress}
            ellipsis={!domainName}
            avatarSrc={avatarSrc}
            text={userMenuText}
            variant={userMenuVariable}
            popperStyle={{
              minWidth: '380px',
            }}
            onClick={() => {
              if (isMobile) {
                setShowMobileWalletModal(true)
              } else {
                // Toggle menu on click for desktop
                setIsMenuOpen((prev) => !prev)
              }
            }}
          >
            {/* Make sure the menu won't be triggered by hover */}
            {undefined}
          </UIKitUserMenu>

          {/* Custom click-based menu for desktop */}
          {!isMobile && (
            <ClickablePopover isOpen={isMenuOpen}>
              {isMenuOpen && showDesktopPopup && (
                <UserMenuItems account={finalAddress} onReceiveClick={() => setIsReceiveModalOpen(true)} />
              )}
            </ClickablePopover>
          )}
        </ClickableUserMenu>

        <WalletModalV2
          isOpen={showMobileWalletModal}
          account={finalAddress}
          onReceiveClick={() => setIsReceiveModalOpen(true)}
          onDisconnect={handleClickDisconnect}
          onDismiss={() => {
            setShowMobileWalletModal(false)
            resetViewState()
          }}
        />
        {finalAddress && (
          <ReceiveModal
            account={finalAddress}
            onDismiss={() => setIsReceiveModalOpen(false)}
            isOpen={isReceiveModalOpen}
          />
        )}
      </>
    )
  }

  if (isWrongNetwork) {
    return (
      <ClickableUserMenu ref={menuRef}>
        <UIKitUserMenu
          text={t('Network')}
          variant="danger"
          onClick={() => {
            if (!isMobile) {
              setIsMenuOpen((prev) => !prev)
            }
          }}
        >
          {!isMobile && !isMenuOpen
            ? ({ isOpen }) =>
                isOpen && <UserMenuItems account={finalAddress} onReceiveClick={() => setIsReceiveModalOpen(true)} />
            : undefined}
        </UIKitUserMenu>

        {/* Custom click-based menu for desktop */}
        {!isMobile && (
          <ClickablePopover isOpen={isMenuOpen}>
            {isMenuOpen && <UserMenuItems account={finalAddress} onReceiveClick={() => setIsReceiveModalOpen(true)} />}
          </ClickablePopover>
        )}
      </ClickableUserMenu>
    )
  }

  return (
    <ConnectWalletButton scale="sm">
      <Box display={['none', null, null, 'block']}>
        <Trans>Connect Wallet</Trans>
      </Box>
      <Box display={['block', null, null, 'none']}>
        <Trans>Connect</Trans>
      </Box>
    </ConnectWalletButton>
  )
}

const UserMenuContainer = () => {
  return (
    <WalletModalV2ViewStateProvider>
      <MenuTabProvider>
        <SendGiftProvider>
          <ClaimGiftProvider>
            <UnclaimedOnlyProvider>
              <UserMenu />
            </UnclaimedOnlyProvider>
          </ClaimGiftProvider>
        </SendGiftProvider>
      </MenuTabProvider>
    </WalletModalV2ViewStateProvider>
  )
}

export default UserMenuContainer
