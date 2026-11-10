import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gtk

app = Gtk.Application(application_id='local.workspace_windows.Test')


def activate(application):
    for index in range(1, 5):
        window = Gtk.ApplicationWindow(application=application)
        window.set_title(f'Workspace test {index}')
        window.set_default_size(400, 250)
        window.set_child(Gtk.Label(label=f'Test window {index}'))
        window.present()


app.connect('activate', activate)
app.run(None)
