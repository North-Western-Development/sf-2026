import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Subspace Frequency',
  description: 'Self-hosted real-time communication: beacons, relays, voice and video, end-to-end encryption.',
  lang: 'en',
  cleanUrls: true,
  // Guides mention local dev servers; every other link must resolve.
  ignoreDeadLinks: 'localhostLinks',
  lastUpdated: true,
  // The app is dark by design; so are its docs.
  appearance: 'force-dark',
  head: [
    ['link', { rel: 'icon', href: '/star.png' }],
    ['meta', { name: 'theme-color', content: '#030305' }],
  ],
  themeConfig: {
    logo: '/star.png',
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Operate', link: '/operate/deployment' },
      { text: 'Reference', link: '/reference/configuration' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Run it locally', link: '/guide/local-development' },
          { text: 'Clients', link: '/guide/clients' },
          { text: 'Security and encryption', link: '/guide/security' },
        ],
      },
      {
        text: 'Operate an instance',
        items: [
          { text: 'Deployment', link: '/operate/deployment' },
          { text: 'Domains and DNS', link: '/operate/domains' },
          { text: 'Reverse proxy', link: '/operate/reverse-proxy' },
          { text: 'Email (SMTP)', link: '/operate/email' },
          { text: 'Voice and video', link: '/operate/voice-video' },
          { text: 'Cloud drives', link: '/operate/cloud-drives' },
          { text: 'Mobile push', link: '/operate/push' },
          { text: 'Backups and recovery', link: '/operate/backups' },
          { text: 'Operator manual', link: '/operate/operator-manual' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'API overview', link: '/reference/api' },
          { text: 'Terminology', link: '/reference/terminology' },
          { text: 'Testing', link: '/reference/testing' },
          { text: 'Roadmap', link: '/reference/roadmap' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: { message: 'A transmission from NWD.' },
  },
});
