import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { SubscribePage } from '~/components/billing/SubscribePage';
import { BuildLiveLogo } from '~/components/ui/BuildLiveLogo';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { APP_NAME } from '~/utils/brand';

export const meta: MetaFunction = () => {
  return [
    { title: `Subscribe — ${APP_NAME}` },
    { name: 'description', content: `Choose a ${APP_NAME} plan` },
  ];
};

export const loader = () => json({});

export default function SubscribeRoute() {
  return (
    <div className="relative min-h-screen w-full bg-bolt-elements-background-depth-1 px-6 py-12">
      <BackgroundRays />
      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center">
        <BuildLiveLogo size="lg" />
        <div className="mt-8 w-full">
          <ClientOnly fallback={<div className="h-64 animate-pulse rounded-xl bg-bolt-elements-background-depth-3" />}>
            {() => <SubscribePage />}
          </ClientOnly>
        </div>
      </div>
    </div>
  );
}
