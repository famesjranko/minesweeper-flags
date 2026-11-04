import "./server-unreachable.css";

export const ServerUnreachableNotice = () => (
  <div className="server-unreachable" role="status">
    <p>
      <strong>Can’t reach the game server.</strong>
      We’ll keep trying. You can still play the bot right now.
    </p>
    <a href="/">Play Solo instead</a>
  </div>
);
