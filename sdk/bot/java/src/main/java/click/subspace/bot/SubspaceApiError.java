package click.subspace.bot;

/** An error answer from the API (or a gateway that refused the bot token). */
public class SubspaceApiError extends RuntimeException {
    private final int status;
    private final String code;

    public SubspaceApiError(String message, int status, String code) {
        super(message);
        this.status = status;
        this.code = code;
    }

    /** The HTTP status, e.g. 403. */
    public int status() {
        return status;
    }

    /** The API's error code, e.g. {@code BOT_FORBIDDEN}, or null. */
    public String code() {
        return code;
    }

    @Override
    public String toString() {
        return "SubspaceApiError(" + status + (code != null ? " " + code : "") + "): " + getMessage();
    }
}
