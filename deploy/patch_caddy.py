from pathlib import Path
from datetime import datetime
import shutil
p = Path('/opt/projects/MobileChatServer/Caddyfile')
s = p.read_text()
marker = '# MCPFORWORK_BEGIN'
if marker in s:
    print('ALREADY_PATCHED')
    raise SystemExit(0)
old = '    reverse_proxy api:8080\n'
new = '''    # MCPFORWORK_BEGIN
    handle /mcp-work/* {
        reverse_proxy mcpforwork-hub:3000
    }

    handle /mcp-agent {
        reverse_proxy mcpforwork-hub:3000
    }

    handle {
        reverse_proxy api:8080
    }
    # MCPFORWORK_END
'''
if old not in s:
    raise SystemExit('Expected MobileChat reverse_proxy line not found; refusing to modify')
backup = p.with_name('Caddyfile.mcpforwork-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(p, backup)
p.write_text(s.replace(old, new, 1))
print('PATCHED')
print('BACKUP=' + str(backup))
