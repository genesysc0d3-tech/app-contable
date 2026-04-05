"use client";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-page-in">
      {children}
    </div>
  );
}
