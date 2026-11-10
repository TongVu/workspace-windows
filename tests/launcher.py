"""Disposable GTK app for shortcut tests; never launches the user's real apps."""
import sys
import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gtk

app_id = sys.argv[1]
app = Gtk.Application(application_id=app_id)


def activate(application):
    for index in range(1, 3):
        window = Gtk.ApplicationWindow(application=application)
        window.set_title(f'{app_id} window {index}')
        window.set_default_size(360, 220)
        window.set_child(Gtk.Label(label=window.get_title()))
        window.present()


app.connect('activate', activate)
app.run([])
