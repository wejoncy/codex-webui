import {createImage} from './image-view.js';

export function renderAttachments(target, attachments, onRemove) {
  target.replaceChildren();
  target.hidden = !attachments.length;
  attachments.forEach((attachment, index) => {
    const chip = document.createElement('div'); chip.className = 'attachment-chip';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', `移除 ${attachment.name}`);
    close.onclick = () => onRemove(index);
    chip.append(createImage(attachment, attachment.name), close);
    target.append(chip);
  });
}
