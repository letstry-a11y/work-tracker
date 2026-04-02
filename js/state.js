// ===== Shared application state =====

export const state = {
  currentUser: null,
  authToken: localStorage.getItem('token') || null,
  employeesCache: [],
  tasksCache: [],
  usersCache: [],
  objectivesCache: [],
  gridWeekStart: '',
};

export function saveSession(token, user) {
  localStorage.setItem('token', token);
  state.authToken = token;
  state.currentUser = user;
}

export function clearSession() {
  localStorage.removeItem('token');
  state.authToken = null;
  state.currentUser = null;
}
