use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

pub fn run(url: String) -> ! {
    let events = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Agent Trace Visualizer")
        .with_inner_size(LogicalSize::new(1280, 820))
        .build(&events)
        .expect("could not create desktop window");
    let builder = WebViewBuilder::new()
        .with_url(&url)
        .with_navigation_handler(move |destination| destination.starts_with(&url))
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny);
    #[cfg(target_os = "linux")]
    let view = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(window.default_vbox().expect("missing GTK container"))
    };
    #[cfg(not(target_os = "linux"))]
    let view = builder.build(&window);
    let view = view.expect("could not initialize the system WebView");
    events.run(move |event, _, flow| {
        let _keep_alive = (&view, &window);
        *flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *flow = ControlFlow::Exit;
        }
    })
}
