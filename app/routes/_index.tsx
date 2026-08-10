import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { Chat } from '~/components/chat/Chat.client';
import { ConsumerShell } from '~/components/consumer/ConsumerShell';
import { SetUiMode } from '~/components/consumer/SetUiMode.client';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { APP_DESCRIPTION, APP_NAME } from '~/utils/brand';

export const meta: MetaFunction = () => {
  return [
    { title: APP_NAME },
    { name: 'description', content: APP_DESCRIPTION },
  ];
};

export const loader = () => json({});

/**
 * Consumer landing: chat + live progress + running app preview.
 * Full IDE remains at /studio for debugging.
 */
export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <ClientOnly>{() => <SetUiMode mode="consumer" />}</ClientOnly>
      <ClientOnly fallback={<ConsumerShell />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
