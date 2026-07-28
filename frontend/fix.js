const fs = require('fs');
const path = require('path');
const dir = './lib/api';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
files.forEach(f => {
  const p = path.join(dir, f);
  let content = fs.readFileSync(p, 'utf8');
  content = content.replace(/'\/v1\//g, "'v1/");
  content = content.replace(/`\/v1\//g, "`v1/");
  fs.writeFileSync(p, content);
});
