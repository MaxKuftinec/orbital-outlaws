"""Build the offline, single-file edition from the modular source."""
from pathlib import Path
base=Path(__file__).parent
html=(base/'index.html').read_text()
css=(base/'styles.css').read_text()
nav=(base/'navigation.js').read_text()
game=(base/'game.js').read_text()
html=html.replace('<link rel="stylesheet" href="styles.css">',f'<style>\n{css}\n</style>')
html=html.replace('<script src="navigation.js" defer></script>','')
html=html.replace('<script src="game.js" defer></script>','')
html=html.replace('</body>',f'<script>\n{nav}\n</script>\n<script>\n{game}\n</script>\n</body>')
(base/'orbital-outlaws.html').write_text(html)
print('Standalone game:',(base/'orbital-outlaws.html').stat().st_size,'bytes')
