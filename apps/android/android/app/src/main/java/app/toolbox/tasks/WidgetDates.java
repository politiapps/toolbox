package app.toolbox.tasks;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/**
 * Java mirror of task-core's presentation.ts date rules, for the widget.
 *
 * The widget renders from a snapshot the app wrote at some earlier point — often
 * days earlier, because nothing regenerates that snapshot unless the app is
 * opened. So the cache carries absolute due dates only, and every *relative*
 * fact (days away, the label, the colour ramp bucket) is derived here against
 * today. Baking those into the snapshot is exactly how a widget ends up
 * labelling a two-day-overdue task "Today" and filing it under Today.
 *
 * This duplicates presentation.ts on purpose: it is date arithmetic rather than
 * task parsing, and it has to run when no webview is alive to do it. The rules
 * are documented in `documentation/ui.md` — change them in both places or the
 * app and the widget will disagree about what "overdue" means.
 */
final class WidgetDates {

    private WidgetDates() {}

    /** Midnight today, local time. */
    private static Calendar midnightToday() {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c;
    }

    /** Parse YYYY-MM-DD as local midnight, or null if malformed. */
    static Calendar parseLocalDate(String iso) {
        if (iso == null || iso.length() < 10) return null;
        try {
            int y = Integer.parseInt(iso.substring(0, 4));
            int m = Integer.parseInt(iso.substring(5, 7));
            int d = Integer.parseInt(iso.substring(8, 10));
            Calendar c = Calendar.getInstance();
            c.clear();
            c.set(y, m - 1, d);
            return c;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Whole days from today to `iso` (negative = past), or null when the date is
     * missing or unparseable. Rounding the millisecond delta rather than dividing
     * keeps the ±1h of a DST boundary from reading as a whole day, matching
     * daysUntil() in presentation.ts.
     */
    static Integer daysUntil(String iso) {
        return daysUntil(iso, midnightToday().getTimeInMillis());
    }

    /**
     * Overload taking the reference day, mirroring the `today` parameter on
     * presentation.ts's daysUntil() — and the seam that lets a test read one
     * snapshot as two different days without touching the system clock.
     */
    static Integer daysUntil(String iso, long todayMidnightMillis) {
        Calendar due = parseLocalDate(iso);
        if (due == null) return null;
        long delta = due.getTimeInMillis() - todayMidnightMillis;
        return (int) Math.round(delta / 86400000.0);
    }

    static String ordinalSuffix(int n) {
        int v = n % 100;
        if (v >= 11 && v <= 13) return "th";
        switch (n % 10) {
            case 1: return "st";
            case 2: return "nd";
            case 3: return "rd";
            default: return "th";
        }
    }

    /** "Thu 25th" — short weekday + day + ordinal, no year. */
    static String formatDueShort(String iso) {
        Calendar c = parseLocalDate(iso);
        if (c == null) return iso;
        String weekday = new SimpleDateFormat("EEE", Locale.getDefault()).format(c.getTime());
        int day = c.get(Calendar.DAY_OF_MONTH);
        return weekday + " " + day + ordinalSuffix(day);
    }

    /**
     * Human label for a due date. The near term reads relatively ("Today",
     * "3d late") because how far off it is *is* the triage fact; past a week out
     * the calendar date itself carries more meaning.
     */
    static String label(String iso, int days) {
        if (days == 0) return "Today";
        if (days == 1) return "Tomorrow";
        if (days == -1) return "Yesterday";
        if (days < -1 && days >= -7) return (-days) + "d late";
        return formatDueShort(iso);
    }

    /** Proximity bucket driving the due-date colour ramp (sooner = warmer). */
    static String state(int days) {
        if (days < 0) return "overdue";
        if (days == 0) return "today";
        if (days == 1) return "tomorrow";
        if (days == 2) return "soon";
        return "upcoming";
    }

    /** State class for the due badge, matching the app's `is-*` classes. */
    static String cssClass(int days) {
        return "is-" + state(days);
    }

    /** Epoch millis of the next local midnight — when every label above changes. */
    static long nextMidnight() {
        Calendar c = midnightToday();
        c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }
}
