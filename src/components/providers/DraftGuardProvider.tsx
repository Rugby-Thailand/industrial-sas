"use client";

/**
 * Compatibility name for the shell's single navigation guard owner. HR,
 * storage and scan editors all register with the same provider; there is
 * no separate HR guard.
 */
export { NavigationGuardProvider as DraftGuardProvider } from "@/components/navigation/NavigationGuardProvider";
