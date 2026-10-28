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
      { text: 'Developers', link: '/developers/' },
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
          { text: 'Bots, webhooks and commands', link: '/guide/bots' },
          { text: 'Activity status and Rich Presence', link: '/guide/rich-presence' },
          { text: 'Security and encryption', link: '/guide/security' },
        ],
      },
      {
        text: 'Developers',
        items: [
          { text: 'Getting started', link: '/developers/' },
          { text: 'Bots', link: '/developers/bots' },
          { text: 'REST API', link: '/developers/rest' },
          { text: 'Gateway', link: '/developers/gateway' },
          { text: 'Gateway events', link: '/developers/events' },
          { text: 'Slash commands and interactions', link: '/developers/commands' },
          { text: 'Embeds', link: '/developers/embeds' },
          { text: 'Webhooks and announcement relays', link: '/developers/webhooks' },
          { text: 'Sign in with Subspace (OAuth2)', link: '/developers/oauth2' },
          { text: 'Activities', link: '/developers/activities' },
          { text: 'Package registry', link: '/developers/registry' },
        ],
      },
      {
        text: 'Bot SDKs',
        collapsed: false,
        items: [
          { text: 'JavaScript and TypeScript', link: '/developers/sdk/javascript' },
          { text: 'Deno', link: '/developers/sdk/deno' },
          { text: 'Python', link: '/developers/sdk/python' },
          { text: 'Java', link: '/developers/sdk/java' },
          { text: 'C# and .NET', link: '/developers/sdk/csharp' },
          { text: 'C++', link: '/developers/sdk/cpp' },
        ],
      },
      {
        text: 'Rich Presence',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/developers/rich-presence/' },
          { text: 'The local protocol', link: '/developers/rich-presence/protocol' },
          { text: 'JavaScript and TypeScript', link: '/developers/rich-presence/javascript' },
          { text: 'C# and .NET', link: '/developers/rich-presence/csharp' },
          { text: 'C++', link: '/developers/rich-presence/cpp' },
          { text: 'Unity', link: '/developers/rich-presence/unity' },
          { text: 'Unreal Engine', link: '/developers/rich-presence/unreal' },
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
