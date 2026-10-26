/** Move an expanded reader outside clipped panes without remounting its editor. */
export function focusLayer(node: HTMLElement, expanded: boolean) {
	let marker: Comment | null = null;
	let active: HTMLElement | null = null;
	let app: HTMLElement | null = null;
	let oldInert = false;
	let overflow = '';
	function update(value: boolean) {
		if (value && !marker) {
			active = document.activeElement as HTMLElement;
			marker = document.createComment('reader-position');
			node.before(marker);
			document.body.append(node);
			app = document.querySelector('.owui-mist-app');
			if (app) {
				oldInert = app.inert;
				app.inert = true;
			}
			overflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			node.tabIndex = -1;
			node.focus({ preventScroll: true });
		} else if (!value && marker) {
			if (app) app.inert = oldInert;
			document.body.style.overflow = overflow;
			marker.replaceWith(node);
			marker = null;
			if (active?.isConnected) active.focus({ preventScroll: true });
		}
	}
	update(expanded);
	return {
		update,
		destroy() {
			update(false);
		}
	};
}
