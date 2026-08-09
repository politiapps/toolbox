package app.toolbox.tasks;

import android.graphics.Color;

/**
 * The widget's half of the shared design language.
 *
 * The web app and the Obsidian panel encode the two triage facts the same way
 * (documentation/ui.md): priority owns a row's left edge, the due date owns a
 * fixed right-hand column, and both ramps decay in *ink* as well as hue so
 * "loud" means "sooner or more important" without resolving the colour. The
 * widget is RemoteViews, so it can't share the CSS — these constants and the
 * drawables in res/drawable/widget_* are the port of that ramp. Keep them in
 * step with the `--overdue / --today / --soon` custom properties in
 * apps/android/src/styles.css.
 */
final class WidgetTheme {

    private WidgetTheme() {}

    /* The proximity/urgency ramp — the plugin's own hexes. */
    static final int OVERDUE = Color.parseColor("#EF4444");
    static final int TODAY = Color.parseColor("#F97316");
    static final int SOON = Color.parseColor("#EAB308");
    static final int MUTED = Color.parseColor("#9A9AA2");
    static final int FAINT = Color.parseColor("#6E6E77");
    static final int UPCOMING = Color.parseColor("#8A8A94");
    static final int ON_FILL = Color.parseColor("#FFFFFF");

    /**
     * The section-identity accents, in the same order as SECTION_ACCENTS in
     * task-core's presentation.ts — a category must be the same colour on the
     * home screen as it is in the app and the sidebar.
     */
    private static final int[] SECTION_ACCENTS = {
        Color.parseColor("#6366F1"), // indigo
        Color.parseColor("#0EA5E9"), // sky
        Color.parseColor("#14B8A6"), // teal
        Color.parseColor("#F59E0B"), // amber
        Color.parseColor("#EC4899"), // pink
        Color.parseColor("#8B5CF6"), // violet
    };

    /**
     * The lane's accent, hashed from its id — the Java twin of `sectionAccent()`
     * in task-core. The hash is widened to a long before the absolute value is
     * taken because JS `Math.abs` on -2^31 yields +2^31 (doubles), while Java's
     * int Math.abs would return -2^31 and pick a negative index.
     */
    static int sectionAccent(String id) {
        if (id == null) return UPCOMING;
        int h = 0;
        for (int i = 0; i < id.length(); i++) h = h * 31 + id.charAt(i);
        long v = Math.abs((long) h);
        return SECTION_ACCENTS[(int) (v % SECTION_ACCENTS.length)];
    }

    /** Text colour for a due badge in the given proximity state. */
    static int dueTextColor(String dueClass) {
        if (dueClass == null) return UPCOMING;
        switch (dueClass) {
            case "is-overdue":
            case "is-today":
                return ON_FILL; // both are filled badges — the label sits on the fill
            case "is-tomorrow":
                return SOON;
            case "is-soon":
                return MUTED;
            default:
                return UPCOMING;
        }
    }

    /**
     * Badge background for a proximity state, or 0 for none. The first two steps
     * are both *filled* because "act now" vs "act later" is the split that
     * matters; the fade is spent on the later steps, and anything beyond two days
     * out gets no badge at all so a wall of future dates reads as texture.
     */
    static int dueBackground(String dueClass) {
        if (dueClass == null) return 0;
        switch (dueClass) {
            case "is-overdue":
                return R.drawable.widget_due_overdue;
            case "is-today":
                return R.drawable.widget_due_today;
            case "is-tomorrow":
                return R.drawable.widget_due_tomorrow;
            case "is-soon":
                return R.drawable.widget_due_soon;
            default:
                return 0;
        }
    }

    /** The urgency ramp shared by the priority chip and the row's left spine. */
    static int priorityColor(String p) {
        if (p == null) return UPCOMING;
        switch (p) {
            case "highest":
                return OVERDUE;
            case "high":
                return TODAY;
            case "medium":
                return SOON;
            default:
                return MUTED;
        }
    }

    /**
     * Spine colour for a priority. Only the top three levels earn ink — low and
     * lowest leave the gutter blank so ink always means urgency.
     */
    static int spineColor(String p) {
        if (p == null) return Color.TRANSPARENT;
        switch (p) {
            case "highest":
                return OVERDUE;
            case "high":
                return TODAY;
            case "medium":
                return SOON;
            default:
                return Color.TRANSPARENT;
        }
    }

    /** Chip background for a priority — ink decays by rank, not only hue. */
    static int priorityBackground(String p) {
        if (p == null) return 0;
        switch (p) {
            case "highest":
                return R.drawable.widget_prio_highest;
            case "high":
                return R.drawable.widget_prio_high;
            case "medium":
                return R.drawable.widget_prio_medium;
            case "low":
            case "lowest":
                return R.drawable.widget_prio_low;
            default:
                return 0;
        }
    }

    static String priorityLabel(String p) {
        if (p == null) return "";
        switch (p) {
            case "highest": return "HIGHEST";
            case "high": return "HIGH";
            case "medium": return "MEDIUM";
            case "low": return "LOW";
            case "lowest": return "LOWEST";
            default: return "";
        }
    }
}
