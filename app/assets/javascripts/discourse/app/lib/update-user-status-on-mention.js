import createUserStatusMessage from "discourse/lib/user-status-message";

let tippyInstances = [];

export function updateUserStatusOnMention(mention, status) {
  removeStatus(mention);
  if (status) {
    const statusHtml = createUserStatusMessage(status, { showTooltip: true });
    tippyInstances.push(statusHtml._tippy);
    mention.appendChild(statusHtml);
  }
}

export function destroyUserStatusOnMentions() {
  tippyInstances.forEach((instance) => {
    instance.destroy();
  });
}

function removeStatus(mention) {
  mention.querySelector("span.user-status-message")?.remove();
}
