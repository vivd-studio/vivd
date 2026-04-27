import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Panel,
  Textarea,
} from "@vivd/ui";
import { WEEKDAY_LABELS, WEEKDAY_ORDER } from "./constants";
import { PeriodEditor, SectionCard, SurfaceList } from "./shared";
import type { SettingsTab, TableBookingPluginInfo } from "./types";
import { formatLongDate, getWeeklyScheduleEntry } from "./utils";
import type { TableBookingConfigDraftState } from "./useConfigDraft";

type SetupTabProps = {
  draft: TableBookingConfigDraftState;
  pluginInfo: TableBookingPluginInfo | undefined;
  setSelectedDate: Dispatch<SetStateAction<string>>;
  setVisibleMonth: Dispatch<SetStateAction<string>>;
  setActiveTab: Dispatch<SetStateAction<SettingsTab>>;
};

export function TableBookingSetupTab({
  draft,
  pluginInfo,
  setSelectedDate,
  setVisibleMonth,
  setActiveTab,
}: SetupTabProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.95fr)]">
      <SectionCard
        title="Weekly hours"
        description="These are the default service windows guests see unless you add a date-specific override."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {WEEKDAY_ORDER.map((dayOfWeek) => {
            const entry = getWeeklyScheduleEntry(
              draft.weeklySchedule,
              dayOfWeek,
            );
            return (
              <Panel tone="sunken" key={dayOfWeek} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {WEEKDAY_LABELS[dayOfWeek]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.periods.length > 0
                        ? `${entry.periods.length} service window${entry.periods.length === 1 ? "" : "s"}`
                        : "Closed by default"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => draft.addWeeklyPeriod(dayOfWeek)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add window
                  </Button>
                </div>
                <div className="mt-3 space-y-3">
                  {entry.periods.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No service windows. Guests can only book this day if you
                      add hours here or create a date override.
                    </p>
                  ) : (
                    entry.periods.map((period, index) => (
                      <PeriodEditor
                        key={`${dayOfWeek}-${index}`}
                        period={period}
                        defaultDurationMinutes={
                          draft.defaultDurationMinutesNumber
                        }
                        onChange={(next) =>
                          draft.updateWeeklyPeriod(dayOfWeek, index, next)
                        }
                        onRemove={() =>
                          draft.removeWeeklyPeriod(dayOfWeek, index)
                        }
                      />
                    ))
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      </SectionCard>

      <div className="space-y-5">
        <SectionCard
          title="Reservation rules"
          description="These defaults apply across the widget and capacity checks."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Input
                value={draft.timezone}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  draft.setTimezone(event.target.value)
                }
                placeholder="Europe/Berlin"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Min party size</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.partyMin}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    draft.setPartyMin(event.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max party size</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.partyMax}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    draft.setPartyMax(event.target.value)
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Lead time (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  value={draft.leadTimeMinutes}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    draft.setLeadTimeMinutes(event.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Booking horizon (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={draft.bookingHorizonDays}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    draft.setBookingHorizonDays(event.target.value)
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Default stay length (minutes)</Label>
                <Input
                  type="number"
                  min={30}
                  value={draft.defaultDurationMinutes}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    draft.setDefaultDurationMinutes(event.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cancellation cutoff (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  value={draft.cancellationCutoffMinutes}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    draft.setCancellationCutoffMinutes(event.target.value)
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.collectNotes}
                onCheckedChange={(value) =>
                  draft.setCollectNotes(Boolean(value))
                }
              />
              Collect guest notes
            </label>
          </div>
        </SectionCard>

        <SectionCard
          title="Notification and embed controls"
          description="These lists still map directly to the plugin config, but they are grouped by outcome instead of raw JSON."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Notification recipient emails</Label>
              <Textarea
                value={draft.notificationRecipientsInput}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  draft.setNotificationRecipientsInput(event.target.value)
                }
                rows={4}
                placeholder="reservations@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Source hosts</Label>
              <Textarea
                value={draft.sourceHostsInput}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  draft.setSourceHostsInput(event.target.value)
                }
                rows={4}
                placeholder="example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Redirect allowlist</Label>
              <Textarea
                value={draft.redirectHostsInput}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  draft.setRedirectHostsInput(event.target.value)
                }
                rows={4}
                placeholder="example.com"
              />
            </div>
            {pluginInfo?.usage ? (
              <SurfaceList
                title="Auto-detected source hosts"
                description="Hosts the widget has already seen from generated snippets or live usage."
                values={pluginInfo.usage.inferredAutoSourceHosts ?? []}
                emptyCopy="No auto-detected hosts yet."
              />
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Saved date overrides"
          description="Use the calendar for editing. This list gives you a quick audit trail of special openings and closures."
        >
          {draft.dateOverrides.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No date overrides yet.
            </p>
          ) : (
            <div className="space-y-2">
              {draft.dateOverrides.map((override) => (
                <Panel
                  tone="sunken"
                  key={override.date}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                >
                  <div className="space-y-1">
                    <button
                      type="button"
                      className="text-left text-sm font-medium hover:underline"
                      onClick={() => {
                        setSelectedDate(override.date);
                        setVisibleMonth(override.date.slice(0, 7));
                        setActiveTab("calendar");
                      }}
                    >
                      {formatLongDate(override.date, draft.timezone)}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {override.closed
                        ? "Closed"
                        : `${(override.periods ?? []).length} custom service window${(override.periods ?? []).length === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={override.closed ? "secondary" : "outline"}>
                      {override.closed ? "Closed" : "Custom hours"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => draft.clearOverride(override.date)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
