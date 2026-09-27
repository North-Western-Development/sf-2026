import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMock = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  completeTwoFactor: vi.fn(),
}));
vi.mock('../services/api', () => ({ api: apiMock }));

import { AuthScreen } from '../features/auth/AuthScreen';

const session = { kind: 'session' as const, transmitter: { id: 't1', username: 'kira' }, requiresRulesAgreement: false };

describe('AuthScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs in with a tag and password', async () => {
    apiMock.login.mockResolvedValue(session);
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);

    await userEvent.type(screen.getByLabelText(/email or tag/i), 'kira#0427');
    await userEvent.type(screen.getByLabelText(/^password/i), 'hunter22!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(apiMock.login).toHaveBeenCalledWith('kira#0427', 'hunter22!');
    expect(onAuthenticated).toHaveBeenCalledWith(session);
  });

  it('explains ambiguous usernames', async () => {
    apiMock.login.mockRejectedValue(Object.assign(new Error('x'), { code: 'AMBIGUOUS_USERNAME', status: 400 }));
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email or tag/i), 'kira');
    await userEvent.type(screen.getByLabelText(/^password/i), 'hunter22!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/full tag/i);
  });

  it('routes through the 2FA challenge and upper-cases backup codes', async () => {
    apiMock.login.mockResolvedValue({ kind: '2fa', challengeToken: 'challenge' });
    apiMock.completeTwoFactor.mockResolvedValue(session);
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);

    await userEvent.type(screen.getByLabelText(/email or tag/i), 'kira#0427');
    await userEvent.type(screen.getByLabelText(/^password/i), 'hunter22!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await userEvent.click(await screen.findByRole('button', { name: /use a backup code/i }));
    await userEvent.type(screen.getByLabelText(/backup code/i), 'abcd1234');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));

    expect(apiMock.completeTwoFactor).toHaveBeenCalledWith('challenge', 'ABCD1234', true);
    expect(onAuthenticated).toHaveBeenCalledWith(session);
  });

  it('requires accepting the directives before registering', async () => {
    apiMock.register.mockResolvedValue(session);
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));

    await userEvent.type(screen.getByLabelText(/^email/i), 'kira@bajor.net');
    await userEvent.type(screen.getByLabelText(/^username/i), 'Kira');
    await userEvent.type(screen.getByLabelText(/^password/i), 'hunter22!');

    const submit = screen.getByRole('button', { name: /continue/i });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    expect(apiMock.register).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'kira', email: 'kira@bajor.net', acceptDirectives: true })
    );
  });

  it('rejects invalid usernames client-side', async () => {
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
    await userEvent.type(screen.getByLabelText(/^username/i), 'bad name!');
    expect(screen.getByLabelText(/^username/i)).toHaveAttribute('aria-invalid', 'true');
  });
});
