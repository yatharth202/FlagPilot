export default function GoogleSignInButton({ onClick, disabled = false, label = "Continue with Google" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-700 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 2)" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.38 37.97 46.98 31.9 46.98 24.55Z" />
        <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.2a24 24 0 0 0 0 21.58l7.98-6.2Z" transform="translate(0 2)" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.98 6.2C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -2)" />
      </svg>
      {label}
    </button>
  );
}
