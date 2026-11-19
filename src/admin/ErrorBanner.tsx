export function ErrorBanner({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="banner error" role="alert">
      <span>{message}</span>
      <button type="button" className="link" aria-label="关闭" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
