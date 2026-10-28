import type { ReactNode } from "react";
import { Lock, Radio, Shield, Users } from "lucide-react";
import { PixelStar } from "./PixelStar";

/** The documentation site (client downloads, self-hosting, security notes). */
const DOCS_URL = import.meta.env.VITE_DOCS_URL || "https://docs.subspace.click";

const STARS = [
  { top: "7%", left: "8%", size: 22, delay: "0s" },
  { top: "14%", left: "86%", size: 30, delay: "1.2s" },
  { top: "38%", left: "4%", size: 14, delay: "2.1s" },
  { top: "52%", left: "93%", size: 18, delay: "0.6s" },
  { top: "70%", left: "14%", size: 12, delay: "1.7s" },
  { top: "24%", left: "52%", size: 10, delay: "2.6s" },
];

interface Feature {
  icon: ReactNode;
  title: string;
  body: string;
  shot: string;
  alt: string;
}

const FEATURES: Feature[] = [
  {
    icon: <Users className="h-6 w-6" />,
    title: "A beacon for every crew",
    body: "Beacons are invite-only spaces for your friends, your guild or your whole community. Split the talk into relays by topic, and see who is around at a glance.",
    shot: "/landing/beacon.png",
    alt: "A beacon with relays in the sidebar, a conversation, and the member list",
  },
  {
    icon: <Radio className="h-6 w-6" />,
    title: "Drop into a Comm-Link",
    body: "Voice rooms you just walk into: no calling, no ringing. Turn on your camera, Holo-Cast your screen, or start Watch Together and the Whiteboard with whoever is there.",
    shot: "/landing/comm-link.png",
    alt: "Two people talking in a Comm-Link, one of them speaking",
  },
  {
    icon: <Lock className="h-6 w-6" />,
    title: "Private by design",
    body: "Direct messages and calls can be end-to-end encrypted, so only the people in them can read or hear them. Voice and video run through Subspace’s own relay, never person to person, so nobody learns your address. No ads, no trackers.",
    shot: "/landing/private.png",
    alt: "An end-to-end encrypted direct conversation",
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "You run the place",
    body: "Clearances decide who can do what, down to a single relay. Moderators get timeouts, AutoMod, server mute and move, and an audit log of every change.",
    shot: "/landing/moderation.png",
    alt: "Beacon settings with clearances and their permissions",
  },
];

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <PixelStar size={26} />
      <span className="font-[family-name:var(--font-display)] text-base font-bold uppercase tracking-[0.18em] text-fg">
        Subspace
      </span>
    </span>
  );
}

function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-raised shadow-modal ring-1 ring-line-strong">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="block w-full"
        draggable={false}
      />
    </div>
  );
}

/**
 * The public homepage (Discord's discord.com): what Subspace is, with ways in. Signed-out
 * visitors land here; signed-in ones go straight to the app.
 */
export function LandingPage({
  signedIn,
  onOpen,
  onLogin,
  onRegister,
}: {
  signedIn: boolean;
  onOpen: () => void;
  onLogin: () => void;
  onRegister: () => void;
}) {
  // Signed in, every way in opens the app.
  if (signedIn) onLogin = onRegister = onOpen;
  const primary =
    "rounded-full bg-brand px-6 py-3 text-base font-semibold text-on-brand shadow-glow transition hover:brightness-110";
  const secondary =
    "rounded-full bg-fg px-6 py-3 text-base font-semibold text-void transition hover:bg-white";
  return (
    <div
      className="h-full w-full overflow-y-auto bg-void text-fg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 60% at 50% 0%, rgb(59 142 242 / 0.22), transparent 70%), radial-gradient(50% 50% at 85% 60%, rgb(51 83 214 / 0.18), transparent 70%), radial-gradient(40% 40% at 10% 90%, rgb(90 92 142 / 0.16), transparent 70%)",
          }}
        />
        {STARS.map((s, i) => (
          <PixelStar
            key={i}
            size={s.size}
            className="pointer-events-none absolute animate-[twinkle_4s_ease-in-out_infinite]"
            style={{ top: s.top, left: s.left, animationDelay: s.delay }}
          />
        ))}

        <header className="relative mx-auto flex max-w-6xl items-center gap-6 px-4 py-5 sm:px-6">
          <a href="/" aria-label="Subspace Frequency home">
            <Brand />
          </a>
          <nav
            aria-label="Site"
            className="ml-auto hidden items-center gap-6 text-sm font-medium text-fg-muted md:flex"
          >
            <a href={`${DOCS_URL}/guide/clients`} className="hover:text-fg">
              Download
            </a>
            <a href={`${DOCS_URL}/guide/security`} className="hover:text-fg">
              Safety
            </a>
            <a href={DOCS_URL} className="hover:text-fg">
              Docs
            </a>
          </nav>
          <button
            type="button"
            onClick={onLogin}
            className="ml-auto rounded-full bg-fg px-4 py-2 text-sm font-semibold text-void hover:bg-white md:ml-0"
          >
            {signedIn ? "Open Subspace" : "Log In"}
          </button>
        </header>

        <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pt-16">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-4xl font-extrabold uppercase leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Your frequency.
              <br />
              <span className="text-brand-gradient">Your people.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-muted">
              Subspace Frequency is where your crews talk, play and hang out:
              chat, voice, video and screen sharing in spaces you run, with
              end-to-end encryption when it matters.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={onRegister} className={primary}>
                Open Subspace in your browser
              </button>
              <a href={`${DOCS_URL}/guide/clients`} className={secondary}>
                Get the apps
              </a>
            </div>
          </div>
          <Shot
            src="/landing/hero.png"
            alt="Subspace Frequency: a beacon with a conversation and the member list"
          />
        </section>
      </div>

      {/* Features, alternating sides */}
      <main>
        {FEATURES.map((f, i) => (
          <section
            key={f.title}
            aria-labelledby={`feature-${i}`}
            className={i % 2 ? "bg-base" : "bg-void"}
          >
            <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16">
              <div className={i % 2 ? "lg:order-2" : undefined}>
                <Shot src={f.shot} alt={f.alt} />
              </div>
              <div>
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand-sky">
                  {f.icon}
                </span>
                <h2
                  id={`feature-${i}`}
                  className="mt-5 font-[family-name:var(--font-display)] text-3xl font-bold leading-tight sm:text-4xl"
                >
                  {f.title}
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-fg-muted">
                  {f.body}
                </p>
              </div>
            </div>
          </section>
        ))}

        {/* Closing call to action */}
        <section className="relative overflow-hidden bg-void">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 70% at 50% 100%, rgb(59 142 242 / 0.2), transparent 70%)",
            }}
          />
          <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
            <PixelStar
              size={44}
              className="mx-auto animate-[twinkle_4s_ease-in-out_infinite]"
            />
            <h2 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-bold sm:text-4xl">
              Ready to tune in?
            </h2>
            <p className="mt-3 text-lg text-fg-muted">
              {signedIn
                ? "Your beacons are waiting."
                : "Make an account, start a beacon, and send your crew the invite."}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {signedIn ? (
                <button type="button" onClick={onOpen} className={primary}>
                  Open Subspace
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onRegister}
                    className={primary}
                  >
                    Create an account
                  </button>
                  <button type="button" onClick={onLogin} className={secondary}>
                    Log In
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-base">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Brand />
            <p className="mt-4 max-w-xs text-sm text-fg-muted">
              Chat, voice and video for the crews you belong to.
            </p>
          </div>
          <nav aria-label="Product">
            <p className="text-sm font-semibold text-brand-sky">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-fg-muted">
              <li>
                <button
                  type="button"
                  onClick={onLogin}
                  className="hover:text-fg"
                >
                  Open Subspace
                </button>
              </li>
              <li>
                <a href={`${DOCS_URL}/guide/clients`} className="hover:text-fg">
                  Desktop and mobile apps
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="Resources">
            <p className="text-sm font-semibold text-brand-sky">Resources</p>
            <ul className="mt-3 space-y-2 text-sm text-fg-muted">
              <li>
                <a href={DOCS_URL} className="hover:text-fg">
                  Documentation
                </a>
              </li>
              <li>
                <a
                  href={`${DOCS_URL}/guide/security`}
                  className="hover:text-fg"
                >
                  Security and encryption
                </a>
              </li>
            </ul>
          </nav>
          {!signedIn && (
            <nav aria-label="Account">
              <p className="text-sm font-semibold text-brand-sky">Account</p>
              <ul className="mt-3 space-y-2 text-sm text-fg-muted">
                <li>
                  <button
                    type="button"
                    onClick={onLogin}
                    className="hover:text-fg"
                  >
                    Log In
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={onRegister}
                    className="hover:text-fg"
                  >
                    Create an account
                  </button>
                </li>
              </ul>
            </nav>
          )}
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-6 text-xs text-fg-subtle sm:px-6">
          <span className="flex items-center gap-2">
            A transmission from
            <img
              src="/brand/nwd-logo.png"
              alt="NWD"
              className="h-8 w-auto"
              draggable={false}
            />
          </span>
          <span className="flex flex-wrap items-center gap-4">
            <a href="/privacy" className="hover:text-fg">Privacy</a>
            <a href="/terms" className="hover:text-fg">Terms</a>
            <a href="/sms" className="hover:text-fg">SMS Terms</a>
            <span>© {new Date().getFullYear()} North Western Development</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
