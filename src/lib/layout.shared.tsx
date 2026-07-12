import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

// The docs.dev wordmark. Hotlinked from the brand's CDN for now — drop the
// file into public/logo.svg and switch LOGO_SRC to '/logo.svg' to vendor it.
const LOGO_SRC = 'https://framerusercontent.com/images/cCPFB7krZHFxQQGI2fQWrx08Nv4.svg';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} alt={appName} style={{ height: 22, width: 'auto' }} />
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
