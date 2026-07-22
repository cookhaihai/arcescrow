import { Component } from "react";

/// 兜底:任何渲染期错误都收在这里,显示可读的提示而不是白屏。
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("ArcEscrow crashed:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="wrap">
        <div className="crash">
          <h1>Something broke on our side.</h1>
          <p>
            The app hit an unexpected error — usually a wallet extension that doesn't play
            well with the page. Try reloading, or connect with a different wallet
            (MetaMask works reliably here).
          </p>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload the page
          </button>
          <pre className="crash-detail">{String(this.state.error?.message ?? this.state.error)}</pre>
        </div>
      </div>
    );
  }
}
