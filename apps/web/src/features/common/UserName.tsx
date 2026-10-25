import { THEME } from '@subspace/ui';
import { clsx } from 'clsx';
import { useStore } from '../../data/store';
import { memberColor } from '../../data/selectors';
import { resolveName } from '../../lib/normalize';
import type { UserRef } from '../../lib/types';
import { useA11yPrefs } from '../../lib/a11yPrefs';

const fontFamily = (font?: string | null) => THEME.fonts.find((f) => f.id === font)?.family;

/**
 * Resolved display name with Discord's precedence: clearance color beats the user's
 * name style; beacon font suppression forces the default font.
 */
export function UserName({
  user,
  beaconId,
  className,
  styled = true,
}: {
  user: UserRef;
  beaconId?: string;
  className?: string;
  /** Apply the user's font / effect (author lines, profiles). */
  styled?: boolean;
}) {
  const member = useStore((s) => (beaconId ? s.members[beaconId]?.[user.id] : undefined));
  const showRoleColors = useA11yPrefs((p) => p.roleColors);
  const roleColor = useStore((s) => (showRoleColors ? memberColor(s, beaconId, member) : null));
  const suppressFonts = useStore((s) => (beaconId ? !!s.beacons[beaconId]?.suppressCustomFonts : false));

  const style = user.displayNameStyle;
  const font = styled && !suppressFonts ? fontFamily(style?.font ?? user.displayFont) : undefined;
  const colors = style?.colors ?? (user.displayColor ? [user.displayColor] : []);
  const effect = style?.effect ?? 'solid';

  const css: React.CSSProperties = { fontFamily: font };
  if (roleColor) css.color = roleColor;
  else if (styled && effect === 'gradient' && colors.length >= 2) {
    css.backgroundImage = `linear-gradient(90deg, ${colors[0]}, ${colors[1]})`;
    css.WebkitBackgroundClip = 'text';
    css.backgroundClip = 'text';
    css.color = 'transparent';
  } else if (styled && colors[0]) {
    css.color = colors[0];
    if (effect === 'neon') css.textShadow = `0 0 6px ${colors[0]}, 0 0 12px ${colors[0]}80`;
    if (effect === 'toon') css.textShadow = `1px 1px 0 #000, 2px 2px 0 ${colors[1] ?? '#000'}`;
    if (effect === 'pop') css.textShadow = `0 2px 0 ${colors[1] ?? 'rgb(0 0 0 / 0.5)'}`;
  }

  return (
    <span className={clsx('truncate', className)} style={css}>
      {resolveName(user, member)}
    </span>
  );
}
