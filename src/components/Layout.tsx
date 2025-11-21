
import React, { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-stone-50 text-ink font-sans antialiased selection:bg-stone-200 selection:text-black">
      {children}
    </div>
  );
};
