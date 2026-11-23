import { Brand } from '../../components/Brand.jsx';
import { Icon } from '../../components/Icon.jsx';
import engraving from './engraving.svg';
import sculpture from './sculpture.svg';

export function AccessLayout({ title, children, role, icon = 'lock' }) {
  return (
    <div className="login">
      <div className="login-art">
        <Brand />
        <img src={engraving} className="engraving" alt="" />
        <img src={sculpture} className="sculpture" alt="" />
      </div>
      <main className="login-side">
        <section className="login-box" aria-labelledby="access-title" role={role}>
          <span className="tile"><Icon name={icon} /></span>
          <h1 id="access-title">{title}</h1>
          {children}
        </section>
      </main>
    </div>
  );
}
