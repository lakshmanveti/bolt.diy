import { APP_NAME } from '~/utils/brand';

/** India mobile without country code; env can override with 10 digits or 91… */
const DEFAULT_SUPPORT_WHATSAPP = '8111862366';

export function getSupportWhatsAppNumber(): string {
  const raw = String(import.meta.env.VITE_SUPPORT_WHATSAPP || DEFAULT_SUPPORT_WHATSAPP).replace(/\D/g, '');

  if (raw.length === 10) {
    return `91${raw}`;
  }

  return raw;
}

export function getSupportWhatsAppUrl(message?: string): string {
  const text = message?.trim() || `Hi, I need help with ${APP_NAME}.`;
  return `https://wa.me/${getSupportWhatsAppNumber()}?text=${encodeURIComponent(text)}`;
}

export function openSupportWhatsApp(message?: string) {
  window.open(getSupportWhatsAppUrl(message), '_blank', 'noopener,noreferrer');
}
