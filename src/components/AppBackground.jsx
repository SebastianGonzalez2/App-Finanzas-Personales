import './AppBackground.css';

export function AppBackground({ contained = false, className }) {
  const classes = ['app-bg', contained && 'app-bg--contained', className].filter(Boolean).join(' ');

  return (
    <div className={classes} aria-hidden="true">
      <div className="app-bg__layer app-bg__columns" />
      <div className="app-bg__layer app-bg__lines" />
      <div className="app-bg__layer app-bg__vignette" />
    </div>
  );
}
