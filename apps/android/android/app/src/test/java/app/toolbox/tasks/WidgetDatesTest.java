package app.toolbox.tasks;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Guards the rule the widget cache once broke: a due date is stored absolute and
 * every relative fact about it is derived against the day it is *read*.
 *
 * The regression these cover cannot be reproduced on a device without changing
 * the system clock, so they live here — `daysUntil(iso, today)` takes the
 * reference day exactly so one fixed date can be read as several different days.
 */
public class WidgetDatesTest {

    /** Local midnight of an ISO day, as the reference "today". */
    private static long on(String iso) {
        return WidgetDates.parseLocalDate(iso).getTimeInMillis();
    }

    private static String labelOn(String due, String today) {
        return WidgetDates.label(due, WidgetDates.daysUntil(due, on(today)));
    }

    private static String classOn(String due, String today) {
        return WidgetDates.cssClass(WidgetDates.daysUntil(due, on(today)));
    }

    /**
     * The actual bug: one unchanged snapshot, read on four successive days. A
     * cached label would have said "Today" for all four.
     */
    @Test
    public void sameDueDateReadsDifferentlyAsDaysPass() {
        String due = "2026-08-05";
        assertEquals("Tomorrow", labelOn(due, "2026-08-04"));
        assertEquals("Today", labelOn(due, "2026-08-05"));
        assertEquals("Yesterday", labelOn(due, "2026-08-06"));
        assertEquals("2d late", labelOn(due, "2026-08-07"));
    }

    /** The colour ramp has to move with the label, or an overdue row stays green. */
    @Test
    public void colourRampTracksTheReadingDay() {
        String due = "2026-08-05";
        assertEquals("is-upcoming", classOn(due, "2026-08-01"));
        assertEquals("is-soon", classOn(due, "2026-08-03"));
        assertEquals("is-tomorrow", classOn(due, "2026-08-04"));
        assertEquals("is-today", classOn(due, "2026-08-05"));
        assertEquals("is-overdue", classOn(due, "2026-08-06"));
    }

    /** Past a week late the relative form gives way to the calendar date. */
    @Test
    public void beyondAWeekFallsBackToShortDate() {
        assertEquals("7d late", labelOn("2026-08-05", "2026-08-12"));
        assertEquals("Wed 5th", labelOn("2026-08-05", "2026-08-13"));
        assertEquals("Wed 5th", labelOn("2026-08-05", "2026-07-20"));
    }

    @Test
    public void ordinalSuffixesMatchPresentationTs() {
        assertEquals("st", WidgetDates.ordinalSuffix(1));
        assertEquals("nd", WidgetDates.ordinalSuffix(2));
        assertEquals("rd", WidgetDates.ordinalSuffix(3));
        assertEquals("th", WidgetDates.ordinalSuffix(4));
        // The 11-13 exception, the one everybody gets wrong.
        assertEquals("th", WidgetDates.ordinalSuffix(11));
        assertEquals("th", WidgetDates.ordinalSuffix(12));
        assertEquals("th", WidgetDates.ordinalSuffix(13));
        assertEquals("st", WidgetDates.ordinalSuffix(21));
        assertEquals("nd", WidgetDates.ordinalSuffix(22));
        assertEquals("rd", WidgetDates.ordinalSuffix(23));
        assertEquals("th", WidgetDates.ordinalSuffix(30));
        assertEquals("st", WidgetDates.ordinalSuffix(31));
    }

    /** Month and year boundaries are just day arithmetic — no off-by-one. */
    @Test
    public void spansMonthAndYearBoundaries() {
        assertEquals(Integer.valueOf(1), WidgetDates.daysUntil("2026-09-01", on("2026-08-31")));
        assertEquals(Integer.valueOf(1), WidgetDates.daysUntil("2027-01-01", on("2026-12-31")));
        assertEquals(Integer.valueOf(-1), WidgetDates.daysUntil("2026-02-28", on("2026-03-01")));
        // 2028 is a leap year: the 29th exists and is one day after the 28th.
        assertEquals(Integer.valueOf(1), WidgetDates.daysUntil("2028-02-29", on("2028-02-28")));
    }

    /** An unparseable or absent date is undated, not a crash and not day zero. */
    @Test
    public void malformedDatesAreUndated() {
        assertEquals(null, WidgetDates.daysUntil(null));
        assertEquals(null, WidgetDates.daysUntil(""));
        assertEquals(null, WidgetDates.daysUntil("2026-08"));
        assertEquals(null, WidgetDates.daysUntil("not-a-date"));
    }

    /** nextMidnight() is when every label above changes — it must be in the future. */
    @Test
    public void nextMidnightIsTheComingMidnight() {
        long now = System.currentTimeMillis();
        long next = WidgetDates.nextMidnight();
        assertEquals(true, next > now);
        assertEquals(true, next - now <= 86400000L);
    }
}
