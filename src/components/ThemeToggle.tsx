import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export const ThemeToggle = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('civicark_theme');
    return stored === 'dark' || stored === 'light' ? stored : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('civicark_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  return (
    <button
      onClick={toggleTheme}
      className="btn btn-ghost btn-sm"
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label="Toggle visual theme"
      style={{ padding: '6px 10px', height: '36px' }}
    >
      {theme === 'light' ? (
        <>
          <Moon size={14} />
          <span className="hidden sm:inline" style={{ fontSize: '0.68rem' }}>DARK</span>
        </>
      ) : (
        <>
          <Sun size={14} />
          <span className="hidden sm:inline" style={{ fontSize: '0.68rem' }}>LIGHT</span>
        </>
      )}
    </button>
  );
};
