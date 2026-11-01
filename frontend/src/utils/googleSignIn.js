const configuredApiUrl = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const API_BASE_URL = configuredApiUrl.endsWith("/api/v1") ? configuredApiUrl : `${configuredApiUrl}/api/v1`;


export const beginGoogleSignIn = (nextPath = "/dashboard") => {
  const url = new URL(`${API_BASE_URL}/auth/google`);
  url.searchParams.set("next", nextPath);
  window.location.assign(url.toString());
};

export const googleSignInErrorMessage = (code) => {
  const messages = {
    not_configured: "Google sign-in has not been configured by the FlagPilot administrator yet.",
    cancelled: "Google sign-in was cancelled.",
    account_conflict: "This email is linked to another Google account. Sign in with the originally linked account.",
    failed: "Google sign-in could not be completed. Please try again.",
  };
  return messages[code] || "Google sign-in could not be completed. Please try again.";
};
