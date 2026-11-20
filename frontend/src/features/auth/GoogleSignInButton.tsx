import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';

/** Botón de Google Identity Services: entrega al callback el ID token que el servidor verifica. */
export function GoogleSignInButton({ clientId, text = 'continue_with', onCredential, onError }: {
  clientId: string;
  text?: 'continue_with' | 'signin_with' | 'signup_with';
  onCredential: (credential: string) => void;
  onError: () => void;
}) {
  return (
    <GoogleOAuthProvider clientId={clientId} locale="es">
      <div className="login__google-gis">
        <GoogleLogin
          text={text}
          shape="pill"
          width={320}
          onSuccess={({ credential }) => (credential ? onCredential(credential) : onError())}
          onError={onError}
        />
      </div>
    </GoogleOAuthProvider>
  );
}
