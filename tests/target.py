import os
import subprocess


def greet(name):
    print("hello")
    print("hello " + name)
    print(f"hi {name}")


def run(cmd):
    user = input()
    os.system(user)
    os.system("ls -la")
    subprocess.call(cmd, shell=True)


def safe(cmd):
    if cmd is None:
        return
    subprocess.call(["ls", cmd])
    eval("1 + 1")


class Svc:
    def __init__(self):
        self.secret = "f449a71cff1d56a122c84fa478c16af9075e5b4b8527787b56580773242e40ce"

    def go(self, x):
        print(x)
        return eval(x)
