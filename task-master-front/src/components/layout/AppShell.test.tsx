import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { Header } from './Header';

const logout = vi.fn();
let user: { displayName: string | null; email: string } | null = {
  displayName: 'Ada',
  email: 'a@b.com',
};
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user, logout }),
}));

const openQuickAdd = vi.fn();
vi.mock('../../contexts/TaskContext', () => ({
  useTasks: () => ({ openQuickAdd }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  user = { displayName: 'Ada', email: 'a@b.com' };
});

describe('BottomNav', () => {
  const renderNav = (path = '/') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <BottomNav />
      </MemoryRouter>,
    );

  it('renders the five slots in order: Tasks, Projects, Add, Profile, Settings', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: /primary/i });
    expect(within(nav).getByLabelText('Tasks')).toBeInTheDocument();
    expect(within(nav).getByLabelText('Projects')).toBeInTheDocument();
    expect(within(nav).getByLabelText('Add task')).toBeInTheDocument();
    expect(within(nav).getByLabelText('Profile')).toBeInTheDocument();
    expect(within(nav).getByLabelText('Settings')).toBeInTheDocument();
  });

  it('marks the active item based on the current route', () => {
    renderNav('/projects');
    expect(screen.getByLabelText('Projects').className).toContain('bottomnav__link--active');
    expect(screen.getByLabelText('Tasks').className).not.toContain('bottomnav__link--active');
  });

  it('renders a prominent center Add button that opens Quick-Add', async () => {
    renderNav();
    const add = screen.getByLabelText('Add task');
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(openQuickAdd).toHaveBeenCalled();
  });
});

describe('Header account dropdown', () => {
  const renderHeader = () =>
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

  it('does not show the menu until the account trigger is clicked', () => {
    renderHeader();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /ada/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the menu and logs out via the menu item (two-step)', async () => {
    renderHeader();
    await userEvent.click(screen.getByRole('button', { name: /ada/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('menuitem', { name: /log out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('closes the menu on Escape', async () => {
    renderHeader();
    await userEvent.click(screen.getByRole('button', { name: /ada/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
