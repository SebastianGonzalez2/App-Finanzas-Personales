/*
 * Neon Edge Button: port a JavaScript y CSS propio del componente original de EasyUI
 * (src/components/ui/NeonEdgeButton.tsx, commit ec2e6e6 de github.com/Surajmaurya1/easyui).
 * Cambios respecto al original: fondo #000000, texto #FFFFFF, Inter Variable, icono
 * configurable (`icon`) en lugar del rayo fijo y elemento configurable (`as`) para poder
 * renderizarlo como enlace de navegación.
 *
 * MIT License
 *
 * Copyright (c) 2026 Suraj Maurya
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import './NeonEdgeButton.css';

export function NeonEdgeButton({
  as: Component = 'button',
  icon,
  children = 'Deploy preview',
  speed = 1,
  glow = true,
  className,
  ...props
}) {
  const duration = `${3 / speed}s`;
  const classes = ['neon-edge-button', glow && 'neon-edge-button--glow', className].filter(Boolean).join(' ');

  return (
    <Component type={Component === 'button' ? 'button' : undefined} className={classes} {...props}>
      {/* Dynamic Animated Border Beam */}
      <span aria-hidden="true" className="neon-edge-button__beam-track">
        <span className="easyui-neon-beam" style={{ animation: `easyui-neon-rotate ${duration} linear infinite` }} />
      </span>

      {/* Button Interior Surface */}
      <span className="neon-edge-button__surface">
        {icon}
        <span className="neon-edge-button__label">{children}</span>
      </span>
    </Component>
  );
}
