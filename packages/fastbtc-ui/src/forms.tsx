import React from 'react';
import './forms.css';

interface InputProps<T> {
    onValueChange: (value: T | null) => void;
    convertValue: (value: string) => T;
    description?: string;
}
export function Input<T>(props: InputProps<T>) {
    const {
        onValueChange,
        convertValue,
        description = ''
    } = props;

    const [strValue, setStrValue] = React.useState('');
    const [error, setError] = React.useState<string>('');

    const updateValue = (e: any) => {
        const str: string = e.target.value;

        setStrValue(str);
        let converted;
        try {
            converted = convertValue(str);
        } catch (e: any) {
            setError(e.message || e.toString);
            onValueChange(null);
            return;
        }

        setError('');
        onValueChange(converted);
    }

    return (
        <div className="Input">
            <input
                type="text"
                value={strValue}
                onChange={updateValue}
                placeholder={description}
            />
            {error && (
                <div className="error">
                    {error}
                </div>
            )}
        </div>
    )
}

export interface ButtonProps {
    [k: string]: any;
}
export const Button: React.FC<ButtonProps> = (props) => {
    const {
        children,
        ...rest
    } = props;
    return (
        <button
            className="Button"
            {...rest}
        >
            {children}

        </button>
    )
}
