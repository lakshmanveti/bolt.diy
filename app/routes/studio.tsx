import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { SetUiMode } from '~/components/consumer/SetUiMode.client';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { APP_NAME, APP_NAME_STUDIO } from '~/utils/brand';

export const meta: MetaFunction = () => {
  return [
    { title: APP_NAME_STUDIO },
    { name: 'description', content: `Developer IDE for ${APP_NAME} (files, editor, terminal, preview)` },
  ];
};

export const loader = () => json({});

/**
 * Full bolt.diy IDE surface for debugging. End users should use `/`.
 */
export default function Studio() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <ClientOnly>{() => <SetUiMode mode="studio" />}</ClientOnly>
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
