import { useState } from 'react';
import { PDF_MESSAGES } from './pdf-messages';

/**
 * Asks for the password of a protected PDF (F2, D-130). The password goes to pdf.js only; it is never saved and is
 * forgotten when the tab closes.
 */
export function PdfPasswordPrompt({ wrong, onSubmit, onCancel }: { wrong: boolean; onSubmit(password: string): void; onCancel(): void }) {
  const [password, setPassword] = useState('');
  return (
    <form
      className="pdf-password"
      aria-label="PDF password"
      onSubmit={(e) => {
        e.preventDefault();
        if (password !== '') onSubmit(password);
      }}
    >
      <p>{PDF_MESSAGES.passwordPrompt}</p>
      <input
        type="password"
        className="text-input"
        aria-label="Password"
        autoComplete="off"
        autoFocus
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? 'pdf-password-error' : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {wrong ? (
        <p id="pdf-password-error" role="alert" className="field-error">
          {PDF_MESSAGES.wrongPassword}
        </p>
      ) : null}
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={password === ''}>
          Open
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
