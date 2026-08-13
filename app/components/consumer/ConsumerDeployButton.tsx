import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { netlifyConnection } from '~/lib/stores/netlify';
import { vercelConnection } from '~/lib/stores/vercel';
import { isGitLabConnected } from '~/lib/stores/gitlabConnection';
import { workbenchStore } from '~/lib/stores/workbench';
import { streamingState } from '~/lib/stores/streaming';
import { classNames } from '~/utils/classNames';
import { NetlifyDeploymentLink } from '~/components/chat/NetlifyDeploymentLink.client';
import { VercelDeploymentLink } from '~/components/chat/VercelDeploymentLink.client';
import { useVercelDeploy } from '~/components/deploy/VercelDeploy.client';
import { useNetlifyDeploy } from '~/components/deploy/NetlifyDeploy.client';
import { useGitHubDeploy } from '~/components/deploy/GitHubDeploy.client';
import { useGitLabDeploy } from '~/components/deploy/GitLabDeploy.client';
import { GitHubDeploymentDialog } from '~/components/deploy/GitHubDeploymentDialog';
import { GitLabDeploymentDialog } from '~/components/deploy/GitLabDeploymentDialog';
import { openSettingsTab } from '~/lib/stores/settings-modal';

/**
 * Icon-only deploy control for the consumer preview toolbar.
 * Reuses bolt deploy hooks and adds a Configure integrations entry.
 */
export function ConsumerDeployButton() {
  const netlifyConn = useStore(netlifyConnection);
  const vercelConn = useStore(vercelConnection);
  const gitlabIsConnected = useStore(isGitLabConnected);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews.find((p) => p.ready && p.baseUrl);
  const isStreaming = useStore(streamingState);

  const [isDeploying, setIsDeploying] = useState(false);
  const [deployingTo, setDeployingTo] = useState<'netlify' | 'vercel' | 'github' | 'gitlab' | null>(null);
  const [showGitHubDeploymentDialog, setShowGitHubDeploymentDialog] = useState(false);
  const [showGitLabDeploymentDialog, setShowGitLabDeploymentDialog] = useState(false);
  const [githubDeploymentFiles, setGithubDeploymentFiles] = useState<Record<string, string> | null>(null);
  const [gitlabDeploymentFiles, setGitlabDeploymentFiles] = useState<Record<string, string> | null>(null);
  const [githubProjectName, setGithubProjectName] = useState('');
  const [gitlabProjectName, setGitlabProjectName] = useState('');

  const { handleVercelDeploy } = useVercelDeploy();
  const { handleNetlifyDeploy } = useNetlifyDeploy();
  const { handleGitHubDeploy } = useGitHubDeploy();
  const { handleGitLabDeploy } = useGitLabDeploy();

  const disabled = isDeploying || isStreaming;

  const runDeploy = async (target: typeof deployingTo, fn: () => Promise<void>) => {
    setIsDeploying(true);
    setDeployingTo(target);

    try {
      await fn();
    } finally {
      setIsDeploying(false);
      setDeployingTo(null);
    }
  };

  const itemClass = (extraDisabled?: boolean) =>
    classNames(
      'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md',
      {
        'opacity-60 cursor-not-allowed': disabled || !activePreview || extraDisabled,
      },
    );

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={classNames(
              'inline-flex items-center justify-center w-8 h-8 rounded-md',
              'border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2',
              'text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            title={isDeploying ? `Deploying to ${deployingTo}…` : 'Deploy'}
            aria-label="Deploy"
          >
            {isDeploying ? (
              <div className="i-svg-spinners:90-ring-with-bg w-4 h-4" />
            ) : (
              <div className="i-ph:rocket-launch w-4 h-4" />
            )}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          className={classNames(
            'z-[250]',
            'bg-bolt-elements-background-depth-2',
            'rounded-lg shadow-lg',
            'border border-bolt-elements-borderColor',
            'animate-in fade-in-0 zoom-in-95',
            'py-1 min-w-[220px]',
          )}
          sideOffset={5}
          align="end"
        >
          <DropdownMenu.Item
            className={itemClass(!netlifyConn.user)}
            disabled={disabled || !activePreview || !netlifyConn.user}
            onClick={() => runDeploy('netlify', () => handleNetlifyDeploy())}
          >
            <img className="w-5 h-5" height="24" width="24" crossOrigin="anonymous" src="https://cdn.simpleicons.org/netlify" alt="" />
            <span className="flex-1">{!netlifyConn.user ? 'Netlify (not connected)' : 'Deploy to Netlify'}</span>
            {netlifyConn.user && <NetlifyDeploymentLink />}
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={itemClass(!vercelConn.user)}
            disabled={disabled || !activePreview || !vercelConn.user}
            onClick={() => runDeploy('vercel', () => handleVercelDeploy())}
          >
            <img
              className="w-5 h-5 bg-black p-1 rounded"
              height="24"
              width="24"
              crossOrigin="anonymous"
              src="https://cdn.simpleicons.org/vercel/white"
              alt=""
            />
            <span className="flex-1">{!vercelConn.user ? 'Vercel (not connected)' : 'Deploy to Vercel'}</span>
            {vercelConn.user && <VercelDeploymentLink />}
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={itemClass()}
            disabled={disabled || !activePreview}
            onClick={() =>
              runDeploy('github', async () => {
                const result = await handleGitHubDeploy();

                if (result?.success && result.files) {
                  setGithubDeploymentFiles(result.files);
                  setGithubProjectName(result.projectName);
                  setShowGitHubDeploymentDialog(true);
                }
              })
            }
          >
            <img className="w-5 h-5" height="24" width="24" crossOrigin="anonymous" src="https://cdn.simpleicons.org/github" alt="" />
            <span className="flex-1">Deploy to GitHub</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={itemClass(!gitlabIsConnected)}
            disabled={disabled || !activePreview || !gitlabIsConnected}
            onClick={() =>
              runDeploy('gitlab', async () => {
                const result = await handleGitLabDeploy();

                if (result?.success && result.files) {
                  setGitlabDeploymentFiles(result.files);
                  setGitlabProjectName(result.projectName);
                  setShowGitLabDeploymentDialog(true);
                }
              })
            }
          >
            <img className="w-5 h-5" height="24" width="24" crossOrigin="anonymous" src="https://cdn.simpleicons.org/gitlab" alt="" />
            <span className="flex-1">{!gitlabIsConnected ? 'GitLab (not connected)' : 'Deploy to GitLab'}</span>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="h-px bg-bolt-elements-borderColor my-1" />

          <DropdownMenu.Item
            className="cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md"
            onClick={() => openSettingsTab('github')}
          >
            <div className="i-ph:gear-six w-5 h-5" />
            <span className="flex-1">Configure integrations</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      {showGitHubDeploymentDialog && githubDeploymentFiles && (
        <GitHubDeploymentDialog
          isOpen={showGitHubDeploymentDialog}
          onClose={() => setShowGitHubDeploymentDialog(false)}
          projectName={githubProjectName}
          files={githubDeploymentFiles}
        />
      )}

      {showGitLabDeploymentDialog && gitlabDeploymentFiles && (
        <GitLabDeploymentDialog
          isOpen={showGitLabDeploymentDialog}
          onClose={() => setShowGitLabDeploymentDialog(false)}
          projectName={gitlabProjectName}
          files={gitlabDeploymentFiles}
        />
      )}
    </>
  );
}
