import { useEffect, useRef, useState } from 'react';
import { useMobileLayout } from './useMobileLayout';

export function useSidebar(routeKey: string) {
  const isMobile = useMobileLayout();
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const brandRef = useRef<HTMLAnchorElement>(null);
  const wasOpen = useRef(false);
  // Changing routes (including Back/Forward) closes the drawer immediately.
  const isOpen = isMobile && openedAt === routeKey;

  useEffect(() => {
    setOpenedAt(null);
  }, [routeKey, isMobile]);

  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
    else if (wasOpen.current) {
      if (isMobile) menuRef.current?.focus();
      else brandRef.current?.focus();
    }
    wasOpen.current = isOpen;
  }, [isOpen, isMobile]);

  return {
    isMobile,
    isOpen,
    menuRef,
    closeRef,
    brandRef,
    openSidebar: () => setOpenedAt(routeKey),
    closeSidebar: () => setOpenedAt(null),
  };
}
