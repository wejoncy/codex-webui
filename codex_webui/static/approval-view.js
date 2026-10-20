import {$} from './dom.js';
export function createApprovalView({requests, active, isReadOnly, respond, updateRunning, scrollBottom, report, toast}) {
  function renderApprovals() {
    document.querySelectorAll('.approval-card').forEach(card => card.remove());
    if (!active() || isReadOnly()) return;
    for (const request of requests.values()) {
      if (request.params?.threadId && request.params.threadId !== active()) continue;
      const key = `approval-${JSON.stringify(request.id)}`;
      if (document.getElementById(key)) continue;
      const p = request.params || {}, method = request.method;
      const card = document.createElement('div'); card.className = 'approval-card'; card.id = key;
      const title = document.createElement('h3'); title.textContent = method.includes('requestUserInput') ? 'Codex 需要你的选择' : method.includes('requestApproval') ? '需要你的审批' : 'Codex 发来了一个请求'; card.append(title);
      const answer = async (result, error) => {
        if (isReadOnly()) return;
        card.querySelectorAll('button').forEach(b => b.disabled = true);
        try { await respond({id:request.id, result, ...(error ? {error} : {})}); card.remove(); requests.delete(JSON.stringify(request.id)); updateRunning(); }
        catch (e) { card.querySelectorAll('button').forEach(b => b.disabled = false); report(e); }
      };
      if (p.reason) { const reason = document.createElement('p'); reason.textContent = p.reason; card.append(reason); }
      const controls = document.createElement('div'); controls.className = 'approval-actions';
      const button = (label, result, primary = false, error = null) => {
        const b = document.createElement('button'); b.className = primary ? 'primary-button' : 'secondary-button'; b.textContent = label; b.onclick = () => answer(result, error); controls.append(b);
      };
      if (method.includes('requestUserInput')) {
        const fields = [];
        for (const question of p.questions || []) {
          const label = document.createElement('label'); label.textContent = question.question;
          const input = document.createElement('input'); input.type = question.isSecret ? 'password' : 'text'; input.placeholder = '输入你的回答';
          if (question.options?.length) {
            const select = document.createElement('select'); select.append(new Option('选择一个选项，或在下方输入', ''));
            for (const option of question.options) select.append(new Option(`${option.label}${option.description ? ` — ${option.description}` : ''}`, option.label));
            select.onchange = () => input.value = select.value; label.append(select);
          }
          label.append(input); card.append(label); fields.push({id:question.id, input});
        }
        const submit = document.createElement('button'); submit.className = 'primary-button'; submit.textContent = '提交回答';
        submit.onclick = () => {
          if (fields.some(f => !f.input.value.trim())) { toast('请回答每个问题'); return; }
          answer({answers:Object.fromEntries(fields.map(f => [f.id,{answers:[f.input.value.trim()]}]))});
        }; controls.append(submit);
      } else if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        const pre = document.createElement('pre'); pre.textContent = p.command || JSON.stringify(p.networkApprovalContext || p.additionalPermissions || {grantRoot:p.grantRoot,threadId:p.threadId}, null, 2); card.append(pre);
        const available = p.availableDecisions;
        for (const [label,decision,primary] of [['允许本次','accept',true],['本会话允许','acceptForSession',false],['拒绝','decline',false],['取消任务','cancel',false]]) {
          if (!available || available.includes(decision)) button(label,{decision},primary);
        }
      } else if (method === 'item/permissions/requestApproval') {
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(p.permissions, null, 2); card.append(pre);
        button('允许本次',{permissions:p.permissions,scope:'turn'},true); button('拒绝',{permissions:{},scope:'turn'});
      } else {
        const pre = document.createElement('pre'); pre.textContent = `${method}\n${JSON.stringify(p, null, 2)}`; card.append(pre);
        button('拒绝此请求',null,false,{code:-32601,message:'This client does not support this server request'});
      }
      card.append(controls); $('messages').append(card); scrollBottom();
    }
  }

  return {renderApprovals};
}
