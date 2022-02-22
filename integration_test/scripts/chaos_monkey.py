#!/usr/bin/env python3
"""
Simulate undesirable network situations by randomly stopping and starting nodes
"""
import pathlib
import random
import shlex
import subprocess
import time

DOCKER_BASE_COMMAND = shlex.split('docker-compose -f docker-compose-base.yml -f docker-compose-regtest.yml')
ROOT_DIR = pathlib.Path(__file__).parent.parent.parent
ALL_SERVICES = {'node1', 'node2', 'node3'}


def main(
    services,
    stopping_chance,
    starting_chance,
    sleep_time,
):
    stopped_services = set()
    print_ps = True
    while True:
        available_services = services - stopped_services
        if stopped_services and random.random() < starting_chance:
            service = random.choice(list(stopped_services))
            stopped_services.remove(service)
            print("Starting", service)
            subprocess.call(
                DOCKER_BASE_COMMAND + ['start', service],
                cwd=ROOT_DIR
            )
            print_ps = True
        elif available_services and random.random() < stopping_chance:
            service = random.choice(list(available_services))
            stopped_services.add(service)
            print("Stopping", service)
            subprocess.call(
                DOCKER_BASE_COMMAND + ['stop', service],
                cwd=ROOT_DIR
            )
            print_ps = True
        if print_ps:
            print("docker ps status:")
            subprocess.call(
                DOCKER_BASE_COMMAND + ['ps'],
                cwd=ROOT_DIR
            )
            print_ps = False
        else:
            print("Not doing anything this iteration, just sleeping", sleep_time, "s...")
        time.sleep(sleep_time)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Start and stop nodes randomly")
    parser.add_argument(
        '--services',
        type=lambda s: set(x.strip() for x in s.split(',')),
        default=ALL_SERVICES,
    )
    parser.add_argument('--stopping-chance', type=float, help='Chance to stop a service (0 - 1.0)', default=0.1)
    parser.add_argument('--starting-chance', type=float, help='Chance to start a stopped service (0 - 1.0)', default=0.3)
    parser.add_argument('--sleep-time', type=float, help="Time to sleep between iterations", default=5)
    args = parser.parse_args()
    try:
        print("Starting chaos monkey with args", args)
        main(
            **vars(args)
        )
    except KeyboardInterrupt:
        pass
