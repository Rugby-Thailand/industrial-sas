import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

/** Client references for the HR module, typed by the generated API. */
export const hrRefs = Object.freeze({
  access: clientRef(api.hr.access.current),
  today: clientRef(api.hr.self.today),
  history: clientRef(api.hr.self.history),
  selfDayDetail: clientRef(api.hr.self.dayDetail),
  profile: clientRef(api.hr.self.profile),
  clockIn: clientRef(api.hr.self.clockIn),
  clockOut: clientRef(api.hr.self.clockOut),
  submitCorrection: clientRef(api.hr.self.submitCorrection),
  queue: clientRef(api.hr.review.queue),
  reviewDayDetail: clientRef(api.hr.review.dayDetail),
  decideCorrection: clientRef(api.hr.review.decideCorrection),
  disposeDay: clientRef(api.hr.review.disposeDay),
  listEmployees: clientRef(api.hr.setup.listEmployees),
  employee: clientRef(api.hr.setup.employee),
  employeeHistory: clientRef(api.hr.setup.employeeHistory),
  memberOptions: clientRef(api.hr.setup.memberOptions),
  saveEmployee: clientRef(api.hr.setup.saveEmployee),
  listHolidays: clientRef(api.hr.setup.listHolidays),
  saveHoliday: clientRef(api.hr.setup.saveHoliday),
  deleteHoliday: clientRef(api.hr.setup.deleteHoliday),
  accessMembers: clientRef(api.hr.setup.accessMembers),
  setMemberAccess: clientRef(api.hr.setup.setMemberAccess),
  periods: clientRef(api.hr.periods.list),
  periodPreview: clientRef(api.hr.periods.preview),
  createPeriod: clientRef(api.hr.periods.create),
  closePeriod: clientRef(api.hr.periods.close),
  startRevision: clientRef(api.hr.periods.startRevision),
  exportCsv: clientRef(api.hr.periods.exportCsv),
  searchReviewEmployees: clientRef(api.hr.search.reviewEmployees),
  searchAdminEmployees: clientRef(api.hr.search.adminEmployees),
  searchPeriodsByRange: clientRef(api.hr.search.periodsByRange),
  interpretSearch: clientRef(api.hr.navigationIntent.interpret),
});
