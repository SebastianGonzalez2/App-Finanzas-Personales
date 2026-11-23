import { useSession } from '../../app/sessionContext.js';

export function AccountMenu({ session }) {
  const { signOut } = useSession();
  return (
    <section className="account-panel" aria-label="Sesión de Google">
      <p>Cuenta de Google</p>
      <p>{session.user.email}</p>
      <button className="btn" onClick={signOut}>Cerrar sesión</button>
    </section>
  );
}
