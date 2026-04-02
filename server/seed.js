// Seed test data
const http = require('http');

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(`http://localhost:3000${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body, 'utf8') }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

async function seed() {
  // Add employees
  const e1 = await post('/api/employees', { name: '\u5F20\u4E09', role: '\u524D\u7AEF\u5F00\u53D1', group_name: 'A\u7EC4' });
  const e2 = await post('/api/employees', { name: '\u674E\u56DB', role: '\u540E\u7AEF\u5F00\u53D1', group_name: 'A\u7EC4' });
  const e3 = await post('/api/employees', { name: '\u738B\u4E94', role: '\u6D4B\u8BD5\u5DE5\u7A0B\u5E08', group_name: 'B\u7EC4' });
  console.log('Employees:', e1, e2, e3);

  // Add tasks
  const t1 = await post('/api/tasks', { title: '\u7528\u6237\u767B\u5F55\u9875\u9762\u5F00\u53D1', description: '\u5B9E\u73B0\u767B\u5F55\u8868\u5355\u548C\u9A8C\u8BC1', assignee_id: e1.id, priority: 'P0', difficulty: 3, estimated_hours: 16, deadline: '2026-03-28' });
  const t2 = await post('/api/tasks', { title: '\u540E\u7AEFAPI\u63A5\u53E3\u5F00\u53D1', description: '\u5F00\u53D1RESTful API', assignee_id: e2.id, priority: 'P1', difficulty: 4, estimated_hours: 24, deadline: '2026-03-27' });
  const t3 = await post('/api/tasks', { title: '\u6D4B\u8BD5\u7528\u4F8B\u7F16\u5199', description: '\u7F16\u5199\u5355\u5143\u6D4B\u8BD5\u548C\u96C6\u6210\u6D4B\u8BD5', assignee_id: e3.id, priority: 'P2', difficulty: 2, estimated_hours: 12, deadline: '2026-03-29' });
  const t4 = await post('/api/tasks', { title: '\u9996\u9875UI\u8BBE\u8BA1', description: '\u8BBE\u8BA1\u9996\u9875\u5E03\u5C40', assignee_id: e1.id, priority: 'P1', difficulty: 3, estimated_hours: 8, deadline: '2026-03-25' });
  console.log('Tasks:', t1.id, t2.id, t3.id, t4.id);

  // Set dependency: t3 depends on t1 and t2
  await post(`/api/tasks/${t3.id}/dependencies`, { depends_on: [t1.id, t2.id] });

  // Daily logs for 3 days (March 23-25)
  const days = ['2026-03-23', '2026-03-24', '2026-03-25'];

  // Zhang San logs
  await post('/api/daily-logs', { employee_id: e1.id, date: days[0], task_id: t1.id, work_content: '\u5B8C\u6210\u767B\u5F55\u9875\u9762HTML\u7ED3\u6784', hours: 6, remark: '' });
  await post('/api/daily-logs', { employee_id: e1.id, date: days[0], task_id: t4.id, work_content: '\u5B8C\u6210\u9996\u9875\u8BBE\u8BA1\u7A3F', hours: 2, remark: '' });
  await post('/api/daily-logs', { employee_id: e1.id, date: days[1], task_id: t1.id, work_content: '\u5B8C\u6210\u767B\u5F55\u8868\u5355\u9A8C\u8BC1', hours: 7, remark: '' });
  await post('/api/daily-logs', { employee_id: e1.id, date: days[2], task_id: t1.id, work_content: '\u5BF9\u63A5API\u5E76\u5B8C\u6210\u8054\u8C03', hours: 8, remark: '' });

  // Li Si logs
  await post('/api/daily-logs', { employee_id: e2.id, date: days[0], task_id: t2.id, work_content: '\u8BBE\u8BA1API\u63A5\u53E3\u6587\u6863', hours: 4, remark: '' });
  await post('/api/daily-logs', { employee_id: e2.id, date: days[1], task_id: t2.id, work_content: '\u5B8C\u6210\u7528\u6237\u6A21\u5757API', hours: 8, remark: '' });
  await post('/api/daily-logs', { employee_id: e2.id, date: days[2], task_id: t2.id, work_content: '\u5B8C\u6210\u8BA2\u5355\u6A21\u5757API', hours: 8, remark: '' });

  // Wang Wu logs
  await post('/api/daily-logs', { employee_id: e3.id, date: days[0], task_id: t3.id, work_content: '\u7F16\u5199\u6D4B\u8BD5\u8BA1\u5212', hours: 5, remark: '' });
  await post('/api/daily-logs', { employee_id: e3.id, date: days[1], task_id: t3.id, work_content: '\u5B8C\u6210\u767B\u5F55\u6A21\u5757\u5355\u5143\u6D4B\u8BD5', hours: 7, remark: '' });
  await post('/api/daily-logs', { employee_id: e3.id, date: days[2], task_id: t3.id, work_content: '\u5B8C\u6210\u96C6\u6210\u6D4B\u8BD5', hours: 6, remark: '' });

  console.log('\nSeed data complete!');
}

seed().catch(console.error);
